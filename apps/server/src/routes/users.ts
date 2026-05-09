import type { FastifyPluginAsync } from 'fastify'
import { createWriteStream, unlink } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { randomBytes } from 'node:crypto'
import { prisma } from '../lib/prisma.js'
import { broadcastAll } from '../ws/handler.js'
import type { UserRole } from '@gander/shared'

const USER_SELECT = {
  id: true,
  username: true,
  displayName: true,
  subtitle: true,
  avatarUrl: true,
  createdAt: true,
  lastSeenAt: true,
  role: true,
  isBanned: true,
  timeoutUntil: true,
} as const

const AVATAR_MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
}

function serializeUser(u: { id: string; username: string; displayName: string; subtitle: string | null; avatarUrl: string | null; createdAt: Date; lastSeenAt: Date | null; role: string; isBanned: boolean; timeoutUntil: Date | null }) {
  return { ...u, role: u.role as UserRole, createdAt: u.createdAt.toISOString(), lastSeenAt: u.lastSeenAt?.toISOString() ?? null, timeoutUntil: u.timeoutUntil?.toISOString() ?? null }
}

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
    broadcastAll({ type: 'user:updated', payload: serializeUser(updated) })
    return updated
  })

  // POST /api/users/me/avatar — upload a profile picture (multipart, field: "file")
  app.post('/me/avatar', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const uploadsDir = process.env.UPLOADS_DIR ?? join(process.cwd(), 'uploads')

    const part = await req.file()
    if (!part) return reply.status(400).send({ error: 'No file uploaded' })

    const ext = AVATAR_MIME_TO_EXT[part.mimetype]
    if (!ext) {
      await part.toBuffer()
      return reply.status(415).send({ error: 'Avatar must be jpeg, png, gif, or webp' })
    }

    // Get old avatarUrl to clean up
    const existing = await prisma.user.findUnique({ where: { id: userId }, select: { avatarUrl: true } })

    const storedName = `avatar_${randomBytes(16).toString('hex')}${ext}`
    const destPath = join(uploadsDir, storedName)
    await pipeline(part.file, createWriteStream(destPath))

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: `/uploads/${storedName}` },
      select: USER_SELECT,
    })

    // Delete old avatar file if present
    if (existing?.avatarUrl) {
      const oldName = existing.avatarUrl.replace(/^\/uploads\//, '')
      unlink(join(uploadsDir, oldName), () => {})
    }

    broadcastAll({ type: 'user:updated', payload: serializeUser(updated) })
    return updated
  })

  // DELETE /api/users/me/avatar — remove profile picture
  app.delete('/me/avatar', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const uploadsDir = process.env.UPLOADS_DIR ?? join(process.cwd(), 'uploads')

    const existing = await prisma.user.findUnique({ where: { id: userId }, select: { avatarUrl: true } })

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null },
      select: USER_SELECT,
    })

    if (existing?.avatarUrl) {
      const oldName = existing.avatarUrl.replace(/^\/uploads\//, '')
      unlink(join(uploadsDir, oldName), () => {})
    }

    broadcastAll({ type: 'user:updated', payload: serializeUser(updated) })
    return reply.status(204).send()
  })
}
