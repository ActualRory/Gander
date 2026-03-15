import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { broadcastAll, broadcastToUser } from '../ws/handler.js'

export const messageRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    try { await req.jwtVerify() } catch { reply.status(401).send({ error: 'Unauthorized' }) }
  })

  // Batch unread counts for multiple channels since given timestamps.
  // Body: { channelLastReadAt: Record<channelId, isoTimestamp> }
  // Returns: { channelId: string, count: number, mentionCount: number }[]
  app.post('/unread', async (req) => {
    const { userId } = req.user as { userId: string }
    const { channelLastReadAt } = req.body as { channelLastReadAt: Record<string, string> }
    return Promise.all(
      Object.entries(channelLastReadAt).map(async ([channelId, lastReadAt]) => {
        const since = new Date(lastReadAt)
        const [count, mentionCount] = await Promise.all([
          prisma.message.count({
            where: { channelId, authorId: { not: userId }, createdAt: { gt: since }, isSystem: false },
          }),
          prisma.mention.count({
            where: { userId, message: { channelId, createdAt: { gt: since } } },
          }),
        ])
        return { channelId, count, mentionCount }
      })
    )
  })

  // GET /api/messages/by-post/:postNumber — look up a message globally by its post number
  app.get('/by-post/:postNumber', async (req, reply) => {
    const num = parseInt((req.params as { postNumber: string }).postNumber, 10)
    if (isNaN(num)) return reply.status(400).send({ error: 'Invalid post number' })
    const msg = await prisma.message.findUnique({
      where: { postNumber: num },
      select: { id: true, channelId: true, createdAt: true },
    })
    if (!msg) return reply.status(404).send({ error: 'Not found' })
    return { id: msg.id, channelId: msg.channelId, createdAt: msg.createdAt.toISOString() }
  })

  app.get('/:channelId', async (req) => {
    const { channelId } = req.params as { channelId: string }
    const { before, limit = '50' } = req.query as { before?: string; limit?: string }

    const messages = await prisma.message.findMany({
      where: {
        channelId,
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      include: {
        author: { select: { id: true, displayName: true } },
        replyTo: { select: { id: true, content: true, author: { select: { displayName: true } } } },
        reactions: { select: { reaction: true, userId: true } },
        mentions: { select: { userId: true } },
        attachments: { select: { id: true, storedName: true, mimeType: true, filename: true, size: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
    })

    return messages.reverse().map((m) => {
      const reactionMap = new Map<string, string[]>()
      for (const r of m.reactions) {
        if (!reactionMap.has(r.reaction)) reactionMap.set(r.reaction, [])
        reactionMap.get(r.reaction)!.push(r.userId)
      }
      const reactions = [...reactionMap.entries()].map(([reaction, userIds]) => ({
        reaction,
        count: userIds.length,
        userIds,
      }))
      return {
        id: m.id,
        channelId: m.channelId,
        authorId: m.authorId,
        authorName: m.author.displayName,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
        editedAt: m.editedAt?.toISOString() ?? null,
        postNumber: m.postNumber,
        replyTo: m.replyTo
          ? { id: m.replyTo.id, authorName: m.replyTo.author.displayName, content: m.replyTo.content.slice(0, 100) || '[image]' }
          : null,
        reactions,
        mentions: m.mentions.map(mn => mn.userId),
        attachments: m.attachments.map(a => ({
          id: a.id,
          url: `/uploads/${a.storedName}`,
          mimeType: a.mimeType,
          filename: a.filename,
          size: a.size,
        })),
        isSystem: m.isSystem,
      }
    })
  })

  app.patch('/:messageId', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { messageId } = req.params as { messageId: string }
    const { content } = req.body as { content: string }

    if (!content?.trim()) return reply.status(400).send({ error: 'Content required' })

    const existing = await prisma.message.findUnique({
      where: { id: messageId },
      select: { authorId: true, channelId: true, channel: { select: { type: true } } },
    })
    if (!existing) return reply.status(404).send({ error: 'Not found' })
    if (existing.authorId !== userId) return reply.status(403).send({ error: 'Forbidden' })

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { content: content.trim(), editedAt: new Date() },
      include: {
        author: { select: { displayName: true } },
        replyTo: { select: { id: true, content: true, author: { select: { displayName: true } } } },
        reactions: { select: { reaction: true, userId: true } },
        mentions: { select: { userId: true } },
        attachments: { select: { id: true, storedName: true, mimeType: true, filename: true, size: true } },
      },
    })

    const reactionMap = new Map<string, string[]>()
    for (const r of updated.reactions) {
      if (!reactionMap.has(r.reaction)) reactionMap.set(r.reaction, [])
      reactionMap.get(r.reaction)!.push(r.userId)
    }

    const payload = {
      id: updated.id,
      channelId: updated.channelId,
      authorId: updated.authorId,
      authorName: updated.author.displayName,
      content: updated.content,
      createdAt: updated.createdAt.toISOString(),
      editedAt: updated.editedAt!.toISOString(),
      postNumber: updated.postNumber,
      replyTo: updated.replyTo
        ? { id: updated.replyTo.id, authorName: updated.replyTo.author.displayName, content: updated.replyTo.content.slice(0, 100) || '[image]' }
        : null,
      reactions: [...reactionMap.entries()].map(([reaction, userIds]) => ({ reaction, count: userIds.length, userIds })),
      mentions: updated.mentions.map(m => m.userId),
      attachments: updated.attachments.map(a => ({
        id: a.id,
        url: `/uploads/${a.storedName}`,
        mimeType: a.mimeType,
        filename: a.filename,
        size: a.size,
      })),
      isSystem: updated.isSystem,
    }

    const isDm = existing.channel.type === 'DM' || existing.channel.type === 'GROUP'
    if (isDm) {
      const members = await prisma.channelMember.findMany({
        where: { channelId: existing.channelId },
        select: { userId: true },
      })
      for (const { userId: memberId } of members) {
        broadcastToUser(memberId, { type: 'message:edited', payload })
      }
    } else {
      broadcastAll({ type: 'message:edited', payload })
    }

    return payload
  })
}
