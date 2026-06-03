import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '../lib/prisma.js'

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    try { await req.jwtVerify() } catch { reply.status(401).send({ error: 'Unauthorized' }) }
  })

  // GET /api/notifications — fetch recent notifications (last 50)
  app.get('/', async (req) => {
    const { userId } = req.user as { userId: string }
    const notifs = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return notifs.map(n => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body ?? null,
      meta: n.meta as Record<string, unknown> | null,
      read: n.read,
      createdAt: n.createdAt.toISOString(),
    }))
  })

  // POST /api/notifications/:id/read
  app.post('/:id/read', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { id } = req.params as { id: string }
    await prisma.notification.updateMany({ where: { id, userId }, data: { read: true } })
    return reply.status(204).send()
  })

  // POST /api/notifications/read-all
  app.post('/read-all', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } })
    return reply.status(204).send()
  })
}
