import type { FastifyPluginAsync } from 'fastify'
import { AccessToken } from 'livekit-server-sdk'

export const voiceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    try { await req.jwtVerify() } catch { reply.status(401).send({ error: 'Unauthorized' }) }
  })

  // Returns a LiveKit token for joining a voice channel room
  app.get('/:channelId/token', async (req) => {
    const { userId } = req.user as { userId: string }
    const { channelId } = req.params as { channelId: string }

    const apiKey = process.env.LIVEKIT_API_KEY ?? 'devkey'
    const apiSecret = process.env.LIVEKIT_API_SECRET ?? 'devsecret'

    const token = new AccessToken(apiKey, apiSecret, { identity: userId })
    token.addGrant({ roomJoin: true, room: channelId, canPublish: true, canSubscribe: true })

    return { token: await token.toJwt(), url: process.env.LIVEKIT_URL ?? 'ws://localhost:7880' }
  })
}
