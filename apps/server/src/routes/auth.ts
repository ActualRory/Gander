import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { createHash } from 'node:crypto'
import bcrypt from 'bcryptjs'

const BCRYPT_ROUNDS = 12

function sha256(password: string): string {
  return createHash('sha256').update(password).digest('hex')
}

async function verifyPassword(password: string, hash: string, version: string): Promise<boolean> {
  if (version === 'bcrypt') return bcrypt.compare(password, hash)
  return sha256(password) === hash
}

function serializeUser(user: {
  id: string
  username: string
  displayName: string
  subtitle: string | null
  avatarUrl: string | null
  createdAt: Date
  lastSeenAt: Date | null
  role: string
  isBanned: boolean
  timeoutUntil: Date | null
}) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    subtitle: user.subtitle,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    lastSeenAt: user.lastSeenAt,
    role: user.role,
    isBanned: user.isBanned,
    timeoutUntil: user.timeoutUntil ?? null,
  }
}

// Login/register are unauthenticated — throttle hard to blunt brute-forcing
const AUTH_RATE_LIMIT = { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/register', AUTH_RATE_LIMIT, async (req, reply) => {
    const { username, displayName, password } = req.body as {
      username?: string
      displayName?: string
      password?: string
    }

    if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{2,32}$/.test(username)) {
      return reply.status(400).send({ error: 'Username must be 2-32 characters (letters, numbers, _ . -)' })
    }
    if (typeof displayName !== 'string' || !displayName.trim() || displayName.trim().length > 50) {
      return reply.status(400).send({ error: 'Display name must be 1-50 characters' })
    }
    if (typeof password !== 'string' || password.length < 8) {
      return reply.status(400).send({ error: 'Password must be at least 8 characters' })
    }

    const existing = await prisma.user.findUnique({ where: { username } })
    if (existing) return reply.status(409).send({ error: 'Username taken' })

    // First user ever registered becomes ROOT
    const userCount = await prisma.user.count()
    const isFirstUser = userCount === 0

    const user = await prisma.user.create({
      data: {
        username,
        displayName: displayName.trim(),
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
        hashVersion: 'bcrypt',
        role: isFirstUser ? 'ROOT' : 'MEMBER',
      },
    })

    // Auto-join any DEFAULT channels
    const defaultChannels = await prisma.channel.findMany({
      where: { visibility: 'DEFAULT', isArchived: false },
      select: { id: true },
    })
    if (defaultChannels.length > 0) {
      await prisma.channelMember.createMany({
        data: defaultChannels.map(c => ({ userId: user.id, channelId: c.id })),
        skipDuplicates: true,
      })
    }

    const token = app.jwt.sign({ userId: user.id })
    return { token, user: serializeUser(user) }
  })

  app.post('/login', AUTH_RATE_LIMIT, async (req, reply) => {
    const { username, password } = req.body as { username?: string; password?: string }
    if (typeof username !== 'string' || typeof password !== 'string') {
      return reply.status(400).send({ error: 'Username and password required' })
    }

    const user = await prisma.user.findUnique({ where: { username } })
    if (!user) return reply.status(401).send({ error: 'Unknown username' })
    if (!(await verifyPassword(password, user.passwordHash, user.hashVersion))) {
      return reply.status(401).send({ error: 'Wrong password' })
    }

    if (user.isBanned) {
      return reply.status(403).send({ error: 'Account banned' })
    }

    if (user.isArchived) {
      return reply.status(403).send({ error: 'Account archived — contact an admin to restore access' })
    }

    if (user.hashVersion !== 'bcrypt') {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
          hashVersion: 'bcrypt',
        },
      })
    }

    const token = app.jwt.sign({ userId: user.id })
    return { token, user: serializeUser(user) }
  })
}
