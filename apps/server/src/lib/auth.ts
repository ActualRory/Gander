import type { FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from './prisma.js'

export type UserRole = 'MEMBER' | 'MODERATOR' | 'ADMIN' | 'SUPERADMIN' | 'ROOT'

const RANK: Record<UserRole, number> = {
  MEMBER: 0,
  MODERATOR: 1,
  ADMIN: 2,
  SUPERADMIN: 3,
  ROOT: 4,
}

export function rankOf(role: UserRole): number {
  return RANK[role] ?? 0
}

export function canPromoteTo(actorRole: UserRole, targetRole: UserRole): boolean {
  // Actor can only set roles strictly below their own rank
  return rankOf(actorRole) > rankOf(targetRole)
}

export function isTimedOut(timeoutUntil: Date | null | undefined): boolean {
  if (!timeoutUntil) return false
  return timeoutUntil.getTime() > Date.now()
}

export function requireRole(minimum: UserRole) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify()
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' })
    }
    const { userId } = req.user as { userId: string }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, isBanned: true, timeoutUntil: true },
    })
    if (!user || user.isBanned) return reply.status(403).send({ error: 'Forbidden' })
    if (rankOf(user.role as UserRole) < rankOf(minimum)) {
      return reply.status(403).send({ error: 'Insufficient permissions' })
    }
  }
}

export async function writeAuditLog(
  actorId: string | null,
  action: string,
  targetId?: string,
  targetType?: string,
  meta?: Record<string, unknown>,
) {
  await prisma.auditLog.create({
    data: { actorId, action, targetId, targetType, meta: (meta ?? undefined) as never },
  })
}
