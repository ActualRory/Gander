import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { createHash } from 'node:crypto'

function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex')
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/register', async (req, reply) => {
    const { username, displayName, password } = req.body as {
      username: string
      displayName: string
      password: string
    }

    const existing = await prisma.user.findUnique({ where: { username } })
    if (existing) return reply.status(409).send({ error: 'Username taken' })

    const user = await prisma.user.create({
      data: { username, displayName, passwordHash: hashPassword(password) },
    })

    const token = app.jwt.sign({ userId: user.id })
    return { token, user: { id: user.id, username: user.username, displayName: user.displayName, createdAt: user.createdAt } }
  })

  app.post('/login', async (req, reply) => {
    const { username, password } = req.body as { username: string; password: string }

    const user = await prisma.user.findUnique({ where: { username } })
    if (!user || user.passwordHash !== hashPassword(password)) {
      return reply.status(401).send({ error: 'Invalid credentials' })
    }

    const token = app.jwt.sign({ userId: user.id })
    return { token, user: { id: user.id, username: user.username, displayName: user.displayName, createdAt: user.createdAt } }
  })
}
