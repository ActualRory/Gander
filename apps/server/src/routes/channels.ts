import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { broadcastAll, broadcastToUser } from '../ws/handler.js'

export const channelRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    try { await req.jwtVerify() } catch { reply.status(401).send({ error: 'Unauthorized' }) }
  })

  app.get('/', async () => {
    return prisma.channel.findMany({ where: { type: { not: 'DM' } }, orderBy: { createdAt: 'asc' } })
  })

  app.post('/', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { name, type } = req.body as { name: string; type: 'TEXT' | 'VOICE' }

    const channel = await prisma.channel.create({
      data: {
        name,
        type,
        creatorId: userId,
        members: { create: { userId } },
      },
    })
    broadcastAll({ type: 'channel:created', payload: { ...channel, createdAt: channel.createdAt.toISOString() } })
    return reply.status(201).send(channel)
  })

  app.post('/:channelId/join', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { channelId } = req.params as { channelId: string }

    await prisma.channelMember.upsert({
      where: { userId_channelId: { userId, channelId } },
      create: { userId, channelId },
      update: {},
    })
    return reply.status(204).send()
  })

  app.patch('/:channelId', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { channelId } = req.params as { channelId: string }
    const { name, topic } = req.body as { name?: string; topic?: string }

    if (!name && topic === undefined) return reply.status(400).send({ error: 'Nothing to update' })

    const channel = await prisma.channel.findUnique({ where: { id: channelId } })
    if (!channel) return reply.status(404).send({ error: 'Not found' })
    if (channel.creatorId !== userId) return reply.status(403).send({ error: 'Forbidden' })

    const updated = await prisma.channel.update({
      where: { id: channelId },
      data: {
        ...(name ? { name } : {}),
        ...(topic !== undefined ? { topic: topic.trim() || null } : {}),
      },
    })
    broadcastAll({ type: 'channel:updated', payload: { ...updated, createdAt: updated.createdAt.toISOString() } })

    if (topic !== undefined && (topic.trim() || null) !== channel.topic) {
      const actor = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } })
      if (actor) {
        const oldTopic = channel.topic ?? null
        const newTopic = topic.trim() || null
        const content = JSON.stringify({ type: 'topic_changed', from: oldTopic, to: newTopic })
        const sysMsg = await prisma.message.create({
          data: { content, channelId, authorId: userId, isSystem: true },
        })
        broadcastAll({
          type: 'message:new',
          payload: {
            id: sysMsg.id,
            channelId,
            authorId: userId,
            authorName: actor.displayName,
            content,
            createdAt: sysMsg.createdAt.toISOString(),
            editedAt: null,
            postNumber: null,
            replyTo: null,
            reactions: [],
            mentions: [],
            attachments: [],
            isSystem: true,
          },
        })
      }
    }

    return updated
  })

  app.delete('/:channelId', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { channelId } = req.params as { channelId: string }

    const channel = await prisma.channel.findUnique({ where: { id: channelId } })
    if (!channel) return reply.status(404).send({ error: 'Not found' })
    if (channel.creatorId !== userId) return reply.status(403).send({ error: 'Forbidden' })

    await prisma.channel.delete({ where: { id: channelId } })
    broadcastAll({ type: 'channel:deleted', payload: { channelId } })
    return reply.status(204).send()
  })

  // GET /api/channels/:channelId/pins
  app.get('/:channelId/pins', async (req) => {
    const { channelId } = req.params as { channelId: string }
    const pins = await prisma.pinnedMessage.findMany({
      where: { channelId },
      include: {
        message: {
          include: {
            author: { select: { id: true, displayName: true } },
            attachments: { select: { id: true, storedName: true, mimeType: true, filename: true, size: true } },
          },
        },
      },
      orderBy: { pinnedAt: 'desc' },
    })
    return pins.map(p => ({
      id: p.id,
      messageId: p.messageId,
      channelId: p.channelId,
      pinnedAt: p.pinnedAt.toISOString(),
      pinnedBy: p.pinnedBy,
      message: {
        id: p.message.id,
        channelId: p.message.channelId,
        authorId: p.message.authorId,
        authorName: p.message.author.displayName,
        content: p.message.content,
        createdAt: p.message.createdAt.toISOString(),
        postNumber: p.message.postNumber,
        attachments: p.message.attachments.map(a => ({
          id: a.id,
          url: `/uploads/${a.storedName}`,
          mimeType: a.mimeType,
          filename: a.filename,
          size: a.size,
        })),
      },
    }))
  })

  // POST /api/channels/:channelId/pins/:messageId
  app.post('/:channelId/pins/:messageId', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { channelId, messageId } = req.params as { channelId: string; messageId: string }

    const existing = await prisma.pinnedMessage.findUnique({
      where: { channelId_messageId: { channelId, messageId } },
    })

    await prisma.pinnedMessage.upsert({
      where: { channelId_messageId: { channelId, messageId } },
      create: { channelId, messageId, pinnedBy: userId },
      update: {},
    })

    if (!existing) {
      const [pinner, pinnedMsg, channel] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } }),
        prisma.message.findUnique({ where: { id: messageId }, select: { content: true, author: { select: { displayName: true } } } }),
        prisma.channel.findUnique({ where: { id: channelId }, select: { type: true } }),
      ])
      if (pinner && pinnedMsg) {
        const sysMsg = await prisma.message.create({
          data: { content: 'pinned', channelId, authorId: userId, replyToId: messageId, isSystem: true },
        })
        const isDm = channel?.type === 'DM' || channel?.type === 'GROUP'
        const outEvent = {
          type: 'message:new' as const,
          payload: {
            id: sysMsg.id,
            channelId,
            authorId: userId,
            authorName: pinner.displayName,
            content: 'pinned',
            createdAt: sysMsg.createdAt.toISOString(),
            editedAt: null,
            postNumber: null,
            replyTo: { id: messageId, authorName: pinnedMsg.author.displayName, content: pinnedMsg.content.slice(0, 100) || '[image]' },
            reactions: [],
            mentions: [],
            attachments: [],
            isSystem: true,
          },
        }
        if (isDm) {
          const members = await prisma.channelMember.findMany({ where: { channelId }, select: { userId: true } })
          for (const { userId: memberId } of members) broadcastToUser(memberId, outEvent)
        } else {
          broadcastAll(outEvent)
        }
      }
    }

    return reply.status(204).send()
  })

  // DELETE /api/channels/:channelId/pins/:messageId
  app.delete('/:channelId/pins/:messageId', async (req, reply) => {
    const { channelId, messageId } = req.params as { channelId: string; messageId: string }
    await prisma.pinnedMessage.deleteMany({ where: { channelId, messageId } })
    return reply.status(204).send()
  })
}
