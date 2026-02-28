import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyJwt from '@fastify/jwt'
import fastifyWebsocket from '@fastify/websocket'
import { authRoutes } from './routes/auth.js'
import { channelRoutes } from './routes/channels.js'
import { messageRoutes } from './routes/messages.js'
import { voiceRoutes } from './routes/voice.js'
import { userRoutes } from './routes/users.js'
import { wsHandler } from './ws/handler.js'

const server = Fastify({ logger: true })

await server.register(fastifyCors, { origin: true })
await server.register(fastifyJwt, { secret: process.env.JWT_SECRET ?? 'dev-secret' })
await server.register(fastifyWebsocket)

await server.register(authRoutes, { prefix: '/api/auth' })
await server.register(channelRoutes, { prefix: '/api/channels' })
await server.register(messageRoutes, { prefix: '/api/messages' })
await server.register(voiceRoutes, { prefix: '/api/voice' })
await server.register(userRoutes, { prefix: '/api/users' })

await server.register(async (app) => {
  app.get('/ws', { websocket: true }, wsHandler)
})

server.get('/health', async () => ({ ok: true }))

await server.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' })
