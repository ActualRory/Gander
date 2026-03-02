import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '../lib/prisma.js'

export const messageRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    try { await req.jwtVerify() } catch { reply.status(401).send({ error: 'Unauthorized' }) }
  })

  // Batch unread counts for multiple channels since given timestamps.
  // Body: { channelLastReadAt: Record<channelId, isoTimestamp> }
  // Returns: { channelId: string, count: number }[]
  app.post('/unread', async (req) => {
    const { userId } = req.user as { userId: string }
    const { channelLastReadAt } = req.body as { channelLastReadAt: Record<string, string> }
    return Promise.all(
      Object.entries(channelLastReadAt).map(async ([channelId, lastReadAt]) => ({
        channelId,
        count: await prisma.message.count({
          where: { channelId, authorId: { not: userId }, createdAt: { gt: new Date(lastReadAt) } },
        }),
      }))
    )
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
          ? { id: m.replyTo.id, authorName: m.replyTo.author.displayName, content: m.replyTo.content.slice(0, 100) }
          : null,
        reactions,
      }
    })
  })
}
