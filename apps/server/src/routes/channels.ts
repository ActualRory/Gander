import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '../lib/prisma.js'

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
    const { name } = req.body as { name: string }

    const channel = await prisma.channel.findUnique({ where: { id: channelId } })
    if (!channel) return reply.status(404).send({ error: 'Not found' })
    if (channel.creatorId !== userId) return reply.status(403).send({ error: 'Forbidden' })

    const updated = await prisma.channel.update({
      where: { id: channelId },
      data: { name },
    })
    return updated
  })

  app.delete('/:channelId', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { channelId } = req.params as { channelId: string }

    const channel = await prisma.channel.findUnique({ where: { id: channelId } })
    if (!channel) return reply.status(404).send({ error: 'Not found' })
    if (channel.creatorId !== userId) return reply.status(403).send({ error: 'Forbidden' })

    await prisma.channel.delete({ where: { id: channelId } })
    return reply.status(204).send()
  })
}
