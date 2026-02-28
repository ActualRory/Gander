import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '../lib/prisma.js'

export const userRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    try {
      await req.jwtVerify()
    } catch {
      reply.status(401).send({ error: 'Unauthorized' })
    }
  })

  app.get('/', async () => {
    return prisma.user.findMany({
      select: { id: true, username: true, displayName: true, createdAt: true },
      orderBy: { displayName: 'asc' },
    })
  })
}
