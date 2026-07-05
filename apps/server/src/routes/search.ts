import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { rankOf, type UserRole } from '../lib/auth.js'

export const searchRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    try { await req.jwtVerify() } catch { reply.status(401).send({ error: 'Unauthorized' }) }
  })

  // GET /api/search?q=text&from=username
  app.get('/', async (req) => {
    const { userId } = req.user as { userId: string }
    const { q, from } = req.query as { q?: string; from?: string }
    if (!q?.trim()) return []

    let fromUserId: string | undefined
    if (from) {
      const user = await prisma.user.findFirst({
        where: { username: { equals: from, mode: 'insensitive' } },
        select: { id: true },
      })
      if (!user) return []
      fromUserId = user.id
    }

    // TEXT channels: searchable if the caller is a member or the channel is
    // open-join (PUBLIC/DEFAULT). SEMI_PUBLIC/PRIVATE content stays member-only.
    // Global mods search everything.
    const actor = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
    const isMod = rankOf((actor?.role as UserRole) ?? 'MEMBER') >= rankOf('MODERATOR')

    const messages = await prisma.message.findMany({
      where: {
        content: { contains: q.trim(), mode: 'insensitive' },
        ...(fromUserId ? { authorId: fromUserId } : {}),
        OR: [
          {
            channel: {
              type: { in: ['TEXT'] },
              ...(isMod ? {} : {
                OR: [
                  { members: { some: { userId } } },
                  { visibility: { in: ['PUBLIC', 'DEFAULT'] } },
                ],
              }),
            },
          },
          { channel: { type: { in: ['DM', 'GROUP'] }, members: { some: { userId } } } },
        ],
      },
      include: {
        author: { select: { displayName: true } },
        channel: { select: { name: true, type: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    return messages.map(m => ({
      id: m.id,
      channelId: m.channelId,
      channelName: m.channel.name,
      channelType: m.channel.type,
      authorName: m.author.displayName,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      postNumber: m.postNumber,
    }))
  })
}
