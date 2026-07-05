import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyJwt from '@fastify/jwt'
import fastifyWebsocket from '@fastify/websocket'
import fastifyMultipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import fastifyRateLimit from '@fastify/rate-limit'
import { MAX_MESSAGE_LENGTH } from '@gander/shared'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { authRoutes } from './routes/auth.js'
import { channelRoutes } from './routes/channels.js'
import { dmRoutes } from './routes/dm.js'
import { messageRoutes } from './routes/messages.js'
import { voiceRoutes } from './routes/voice.js'
import { userRoutes } from './routes/users.js'
import { reactionRoutes } from './routes/reactions.js'
import { attachmentRoutes } from './routes/attachments.js'
import { ogRoutes } from './routes/og.js'
import { searchRoutes } from './routes/search.js'
import { libraryRoutes } from './routes/library.js'
import { fileManagerRoutes } from './routes/fileManager.js'
import { gandleRoutes } from './routes/gandle.js'
import { adminRoutes } from './routes/admin.js'
import { recoveryRoutes } from './routes/recovery.js'
import { notificationRoutes } from './routes/notifications.js'
import { wsHandler } from './ws/handler.js'

const UPLOADS_DIR = process.env.UPLOADS_DIR ?? join(process.cwd(), 'uploads')
mkdirSync(UPLOADS_DIR, { recursive: true })

const server = Fastify({ logger: true })

// Every hand-rolled error in the app is `{ error: string }` — keep unhandled
// errors (Prisma failures, throws) in the same shape instead of Fastify's
// default { statusCode, error, message }
server.setErrorHandler((err, req, reply) => {
  const { code, statusCode, message } = err as { code?: string; statusCode?: number; message?: string }
  if (code === 'P2025') return reply.status(404).send({ error: 'Not found' })
  if (code === 'P2002' || code === 'P2003') {
    return reply.status(400).send({ error: 'Invalid request' })
  }
  if (statusCode && statusCode < 500) {
    return reply.status(statusCode).send({ error: message ?? 'Request failed' })
  }
  req.log.error(err)
  return reply.status(500).send({ error: 'Internal server error' })
})
server.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'Not found' }))

await server.register(fastifyCors, { origin: true })
await server.register(fastifyJwt, { secret: process.env.JWT_SECRET ?? 'dev-secret' })
await server.register(fastifyRateLimit, {
  max: 300,
  timeWindow: '1 minute',
  allowList: (req) => req.url.startsWith('/uploads/') || req.url === '/ws' || req.url === '/health',
  errorResponseBuilder: () => ({ error: 'too many requests — slow down', statusCode: 429 }),
})
await server.register(fastifyWebsocket)
const MAX_UPLOAD_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 500) * 1024 * 1024
await server.register(fastifyMultipart, {
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 5, fields: 0 },
})
await server.register(fastifyStatic, {
  root: UPLOADS_DIR,
  prefix: '/uploads/',
  decorateReply: false,
})

await server.register(authRoutes, { prefix: '/api/auth' })
await server.register(channelRoutes, { prefix: '/api/channels' })
await server.register(dmRoutes, { prefix: '/api/dm' })
await server.register(messageRoutes, { prefix: '/api/messages' })
await server.register(voiceRoutes, { prefix: '/api/voice' })
await server.register(userRoutes, { prefix: '/api/users' })
await server.register(reactionRoutes, { prefix: '/api/reactions' })
await server.register(attachmentRoutes, { prefix: '/api/attachments' })
await server.register(ogRoutes, { prefix: '/api/og' })
await server.register(searchRoutes, { prefix: '/api/search' })
await server.register(libraryRoutes, { prefix: '/api/library' })
await server.register(fileManagerRoutes, { prefix: '/api/file-manager' })
await server.register(gandleRoutes, { prefix: '/api/gandle' })
await server.register(adminRoutes, { prefix: '/api/admin' })
await server.register(recoveryRoutes, { prefix: '/api/recovery' })
await server.register(notificationRoutes, { prefix: '/api/notifications' })

await server.register(async (app) => {
  app.get('/ws', { websocket: true }, wsHandler)
})

server.get('/health', async () => ({ ok: true }))

// Public config — single source of truth for client-side limits
server.get('/api/config', async () => ({
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB) || 500,
  maxMessageLength: MAX_MESSAGE_LENGTH,
}))

if (process.env.NODE_ENV === 'production') {
  if (!process.env.LIVEKIT_API_SECRET) {
    server.log.warn('LIVEKIT_API_SECRET is not set — voice token issuance is disabled')
  }
  if (!process.env.JWT_SECRET) {
    server.log.warn('JWT_SECRET is not set — using the insecure dev default!')
  }
}

await server.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' })
