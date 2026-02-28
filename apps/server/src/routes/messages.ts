import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '../lib/prisma.js'

export const messageRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    try { await req.jwtVerify() } catch { reply.status(401).send({ error: 'Unauthorized' }) }
  })

  app.get('/:channelId', async (req) => {
    const { channelId } = req.params as { channelId: string }
    const { before, limit = '50' } = req.query as { before?: string; limit?: string }

    const messages = await prisma.message.findMany({
      where: {
        channelId,
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      include: { author: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
    })

    return messages.reverse().map((m) => ({
      id: m.id,
      channelId: m.channelId,
      authorId: m.authorId,
      authorName: m.author.displayName,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      editedAt: m.editedAt?.toISOString() ?? null,
    }))
  })
}
