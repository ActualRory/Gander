import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { broadcastToUser } from '../ws/handler.js'

export const dmRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    try { await req.jwtVerify() } catch { reply.status(401).send({ error: 'Unauthorized' }) }
  })

  // GET /api/dm — list all DM channels for the current user
  app.get('/', async (req) => {
    const { userId } = req.user as { userId: string }

    const memberships = await prisma.channelMember.findMany({
      where: { userId, channel: { type: 'DM' } },
      include: { channel: true },
    })

    return memberships.map(m => {
      // Derive the other user's ID from the channel name (dm:minId:maxId)
      const parts = m.channel.name.split(':')
      const otherId = parts[1] === userId ? parts[2] : parts[1]
      return { ...m.channel, createdAt: m.channel.createdAt.toISOString(), otherUserId: otherId }
    })
  })

  // POST /api/dm — create or find a DM channel with targetUserId
  app.post('/', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { targetUserId } = req.body as { targetUserId: string }

    if (userId === targetUserId) {
      return reply.status(400).send({ error: 'Cannot DM yourself' })
    }

    // Check target user exists
    const target = await prisma.user.findUnique({ where: { id: targetUserId } })
    if (!target) return reply.status(404).send({ error: 'User not found' })

    // Stable name: dm:smallerId:largerId
    const [a, b] = [userId, targetUserId].sort()
    const dmName = `dm:${a}:${b}`

    // Find existing DM channel between these two users
    const existing = await prisma.channel.findFirst({
      where: { name: dmName, type: 'DM' },
    })

    if (existing) {
      // Ensure both users are still members (re-add if they were removed)
      await prisma.channelMember.upsert({
        where: { userId_channelId: { userId, channelId: existing.id } },
        create: { userId, channelId: existing.id },
        update: {},
      })
      await prisma.channelMember.upsert({
        where: { userId_channelId: { userId: targetUserId, channelId: existing.id } },
        create: { userId: targetUserId, channelId: existing.id },
        update: {},
      })
      return { ...existing, createdAt: existing.createdAt.toISOString(), otherUserId: targetUserId }
    }

    // Create new DM channel
    const channel = await prisma.channel.create({
      data: {
        name: dmName,
        type: 'DM',
        creatorId: null,
        members: {
          create: [{ userId }, { userId: targetUserId }],
        },
      },
    })

    const payload = { ...channel, createdAt: channel.createdAt.toISOString(), otherUserId: targetUserId }

    // Notify the other user if they're online
    broadcastToUser(targetUserId, {
      type: 'dm:new',
      payload: { ...channel, createdAt: channel.createdAt.toISOString(), otherUserId: userId },
    })

    return reply.status(201).send(payload)
  })
}
