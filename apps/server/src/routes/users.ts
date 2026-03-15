import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { broadcastAll } from '../ws/handler.js'

const USER_SELECT = {
  id: true,
  username: true,
  displayName: true,
  subtitle: true,
  createdAt: true,
  lastSeenAt: true,
} as const

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
      select: USER_SELECT,
      orderBy: { displayName: 'asc' },
    })
  })

  app.get('/:id/stats', async (req) => {
    const { id } = req.params as { id: string }
    const [messageCount, sessions] = await Promise.all([
      prisma.message.count({ where: { authorId: id } }),
      prisma.voiceSession.findMany({
        where: { userId: id, leftAt: { not: null } },
        select: { joinedAt: true, leftAt: true },
      }),
    ])
    const voiceSeconds = sessions.reduce((sum, s) => {
      return sum + Math.floor((s.leftAt!.getTime() - s.joinedAt.getTime()) / 1000)
    }, 0)
    return { messageCount, voiceSeconds }
  })

  app.patch('/me', async (req) => {
    const { subtitle } = req.body as { subtitle: string | null }
    const updated = await prisma.user.update({
      where: { id: (req.user as { userId: string }).userId },
      data: { subtitle: subtitle ?? null },
      select: USER_SELECT,
    })
    broadcastAll({ type: 'user:updated', payload: { ...updated, createdAt: updated.createdAt.toISOString(), lastSeenAt: updated.lastSeenAt?.toISOString() ?? null } })
    return updated
  })
}
