import type { FastifyPluginAsync } from 'fastify'
import { AccessToken } from 'livekit-server-sdk'
import { prisma } from '../lib/prisma.js'

export const voiceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    try { await req.jwtVerify() } catch { reply.status(401).send({ error: 'Unauthorized' }) }
  })

  // Returns a LiveKit token for joining a voice channel room
  app.get('/:channelId/token', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { channelId } = req.params as { channelId: string }

    // Moderation gate — banned/archived/timed-out users cannot join voice
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isBanned: true, isArchived: true, timeoutUntil: true },
    })
    if (!user || user.isBanned) return reply.status(403).send({ error: 'account banned' })
    if (user.isArchived) return reply.status(403).send({ error: 'account archived' })
    if (user.timeoutUntil && user.timeoutUntil > new Date()) {
      return reply.status(403).send({ error: `you are timed out until ${user.timeoutUntil.toISOString().slice(0, 16).replace('T', ' ')} UTC` })
    }

    const apiKey = process.env.LIVEKIT_API_KEY ?? 'devkey'
    const apiSecret = process.env.LIVEKIT_API_SECRET ?? 'gander_dev_livekit_secret_0000000'

    const token = new AccessToken(apiKey, apiSecret, { identity: userId })
    token.addGrant({ roomJoin: true, room: channelId, canPublish: true, canSubscribe: true })

    const livekitUrl = process.env.LIVEKIT_PUBLIC_URL ?? process.env.LIVEKIT_URL ?? 'ws://localhost:7880'
    return { token: await token.toJwt(), url: livekitUrl }
  })
}
