import { prisma } from './prisma.js'
import { broadcastToUser } from '../ws/handler.js'

const RANK: Record<string, number> = { MEMBER: 0, MODERATOR: 1, ADMIN: 2, SUPERADMIN: 3, ROOT: 4 }

export async function createNotification(
  userId: string,
  type: string,
  title: string,
  body?: string,
  meta?: Record<string, unknown>,
) {
  const notif = await prisma.notification.create({
    data: { userId, type, title, body, meta: (meta ?? undefined) as never },
  })
  broadcastToUser(userId, {
    type: 'notification:new',
    payload: {
      id: notif.id,
      type: notif.type,
      title: notif.title,
      body: notif.body ?? null,
      meta: notif.meta as Record<string, unknown> | null,
      read: notif.read,
      createdAt: notif.createdAt.toISOString(),
    },
  })
  return notif
}

export async function notifyUsersAtOrAbove(
  minRole: string,
  type: string,
  title: string,
  body?: string,
  meta?: Record<string, unknown>,
) {
  const minRank = RANK[minRole] ?? 0
  const users = await prisma.user.findMany({
    where: { isBanned: false },
    select: { id: true, role: true },
  })
  await Promise.all(
    users
      .filter(u => (RANK[u.role] ?? 0) >= minRank)
      .map(u => createNotification(u.id, type, title, body, meta)),
  )
}
