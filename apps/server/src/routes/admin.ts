import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { broadcastAll, broadcastToUser, forceDisconnectUser } from '../ws/handler.js'
import { requireRole, canPromoteTo, rankOf, writeAuditLog, type UserRole } from '../lib/auth.js'
import { createNotification } from '../lib/notifier.js'
import type { UserRole as SharedUserRole, ChannelType, ChannelVisibility } from '@gander/shared'

function serializeUser(u: {
  id: string; username: string; displayName: string; subtitle: string | null
  avatarUrl: string | null; createdAt: Date; lastSeenAt: Date | null
  role: string; isBanned: boolean; timeoutUntil: Date | null
}) {
  return {
    id: u.id, username: u.username, displayName: u.displayName,
    subtitle: u.subtitle, avatarUrl: u.avatarUrl,
    createdAt: u.createdAt.toISOString(),
    lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
    role: u.role as SharedUserRole, isBanned: u.isBanned,
    timeoutUntil: u.timeoutUntil?.toISOString() ?? null,
  }
}

function serializeChannel(ch: {
  id: string; name: string; type: string; topic: string | null
  createdAt: Date; creatorId: string | null; visibility: string; isArchived: boolean
}) {
  return {
    id: ch.id, name: ch.name, type: ch.type as ChannelType, topic: ch.topic,
    createdAt: ch.createdAt.toISOString(),
    creatorId: ch.creatorId, visibility: ch.visibility as ChannelVisibility, isArchived: ch.isArchived,
  }
}

const MOD_SELECT = {
  id: true, username: true, displayName: true, subtitle: true, avatarUrl: true,
  createdAt: true, lastSeenAt: true, role: true, isBanned: true, timeoutUntil: true,
} as const

export const adminRoutes: FastifyPluginAsync = async (app) => {
  // All admin routes require at least MODERATOR
  app.addHook('preHandler', requireRole('MODERATOR'))

  // ─── Users ───────────────────────────────────────────────────────────────────

  // GET /api/admin/users
  app.get('/users', async () => {
    const users = await prisma.user.findMany({
      select: { ...MOD_SELECT, _count: { select: { messages: true } } },
      orderBy: { createdAt: 'asc' },
    })
    return users.map(u => ({ ...serializeUser(u), messageCount: u._count.messages }))
  })

  // GET /api/admin/users/:id/bans
  app.get('/users/:id/bans', async (req, reply) => {
    const { id } = req.params as { id: string }
    const bans = await prisma.ban.findMany({
      where: { userId: id },
      include: { issuedBy: { select: { displayName: true } } },
      orderBy: { bannedAt: 'desc' },
    })
    return bans.map(b => ({
      id: b.id, userId: b.userId,
      issuedById: b.issuedById, issuedByName: b.issuedBy.displayName,
      reason: b.reason, bannedAt: b.bannedAt.toISOString(),
      unbannedAt: b.unbannedAt?.toISOString() ?? null,
      active: b.active,
    }))
  })

  // PATCH /api/admin/users/:id/role — ADMIN+ only
  app.patch('/users/:id/role', { preHandler: [requireRole('ADMIN')] }, async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { id } = req.params as { id: string }
    const { role } = req.body as { role: UserRole }

    const [actor, target] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
      prisma.user.findUnique({ where: { id }, select: { role: true } }),
    ])
    if (!actor || !target) return reply.status(404).send({ error: 'Not found' })
    if (!canPromoteTo(actor.role as UserRole, role)) {
      return reply.status(403).send({ error: 'Cannot assign a role at or above your own' })
    }
    // Cannot demote someone at or above your rank
    if (rankOf(target.role as UserRole) >= rankOf(actor.role as UserRole)) {
      return reply.status(403).send({ error: 'Cannot modify a user at or above your role' })
    }
    // ROOT role is immutable
    if (target.role === 'ROOT') return reply.status(403).send({ error: 'Cannot modify ROOT' })

    const updated = await prisma.user.update({ where: { id }, data: { role } })
    await writeAuditLog(userId, 'user.role_changed', id, 'user', { from: target.role, to: role })
    broadcastAll({ type: 'user:role_changed', payload: { userId: id, role: updated.role as UserRole } })
    return reply.status(204).send()
  })

  // POST /api/admin/users/:id/timeout — MOD capped at 48hr, ADMIN+ unlimited
  app.post('/users/:id/timeout', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { id } = req.params as { id: string }
    const { duration, reason } = req.body as { duration: number; reason?: string }

    const [actor, target] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
      prisma.user.findUnique({ where: { id }, select: { role: true } }),
    ])
    if (!actor || !target) return reply.status(404).send({ error: 'Not found' })
    if (rankOf(target.role as UserRole) >= rankOf(actor.role as UserRole)) {
      return reply.status(403).send({ error: 'Cannot timeout a user at or above your role' })
    }

    // MOD can timeout max 48hr (2880 min); ADMIN+ unlimited
    const actorRank = rankOf(actor.role as UserRole)
    const maxMinutes = actorRank >= rankOf('ADMIN') ? Infinity : 2880
    const clampedDuration = Math.min(duration, maxMinutes)
    const timeoutUntil = new Date(Date.now() + clampedDuration * 60 * 1000)

    await prisma.user.update({ where: { id }, data: { timeoutUntil } })
    await writeAuditLog(userId, 'user.timeout', id, 'user', { duration: clampedDuration, reason })
    broadcastAll({ type: 'user:timedout', payload: { userId: id, timeoutUntil: timeoutUntil.toISOString() } })
    return reply.status(204).send()
  })

  // DELETE /api/admin/users/:id/timeout
  app.delete('/users/:id/timeout', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { id } = req.params as { id: string }
    await prisma.user.update({ where: { id }, data: { timeoutUntil: null } })
    await writeAuditLog(userId, 'user.untimeout', id, 'user')
    broadcastAll({ type: 'user:untimeout', payload: { userId: id } })
    return reply.status(204).send()
  })

  // POST /api/admin/users/:id/ban — ADMIN+ only
  app.post('/users/:id/ban', { preHandler: [requireRole('ADMIN')] }, async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { id } = req.params as { id: string }
    const { reason } = (req.body ?? {}) as { reason?: string }

    const [actor, target] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
      prisma.user.findUnique({ where: { id }, select: { role: true, isBanned: true } }),
    ])
    if (!actor || !target) return reply.status(404).send({ error: 'Not found' })
    if (target.isBanned) return reply.status(409).send({ error: 'User is already banned' })
    if (rankOf(target.role as UserRole) >= rankOf(actor.role as UserRole)) {
      return reply.status(403).send({ error: 'Cannot ban a user at or above your role' })
    }
    if (target.role === 'ROOT') return reply.status(403).send({ error: 'Cannot ban ROOT' })

    await prisma.$transaction([
      prisma.ban.create({ data: { userId: id, issuedById: userId, reason: reason ?? null } }),
      prisma.user.update({ where: { id }, data: { isBanned: true } }),
    ])
    await writeAuditLog(userId, 'user.ban', id, 'user', { reason })
    broadcastAll({ type: 'user:banned', payload: { userId: id } })
    forceDisconnectUser(id)
    return reply.status(204).send()
  })

  // POST /api/admin/users/:id/unban — ADMIN+ only
  app.post('/users/:id/unban', { preHandler: [requireRole('ADMIN')] }, async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { id } = req.params as { id: string }

    await prisma.$transaction([
      prisma.ban.updateMany({ where: { userId: id, active: true }, data: { active: false, unbannedAt: new Date() } }),
      prisma.user.update({ where: { id }, data: { isBanned: false } }),
    ])
    await writeAuditLog(userId, 'user.unban', id, 'user')
    broadcastAll({ type: 'user:unbanned', payload: { userId: id } })
    return reply.status(204).send()
  })

  // PATCH /api/admin/users/:id/displayName — ADMIN+ only
  app.patch('/users/:id/displayName', { preHandler: [requireRole('ADMIN')] }, async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { id } = req.params as { id: string }
    const { displayName } = req.body as { displayName: string }

    if (!displayName?.trim()) return reply.status(400).send({ error: 'displayName required' })

    const [actor, target] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
      prisma.user.findUnique({ where: { id }, select: { role: true, displayName: true } }),
    ])
    if (!actor || !target) return reply.status(404).send({ error: 'Not found' })
    if (rankOf(target.role as UserRole) >= rankOf(actor.role as UserRole)) {
      return reply.status(403).send({ error: 'Cannot modify a user at or above your role' })
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { displayName: displayName.trim() },
      select: { ...MOD_SELECT },
    })
    await writeAuditLog(userId, 'user.rename', id, 'user', { from: target.displayName, to: displayName.trim() })
    broadcastAll({ type: 'user:updated', payload: serializeUser(updated) })
    return reply.status(204).send()
  })

  // ─── Channels ─────────────────────────────────────────────────────────────────

  // GET /api/admin/channels
  app.get('/channels', async () => {
    const channels = await prisma.channel.findMany({
      where: { type: { notIn: ['DM', 'GROUP'] } },
      include: { _count: { select: { members: true, messages: true } } },
      orderBy: { createdAt: 'asc' },
    })
    return channels.map(ch => ({
      ...serializeChannel(ch),
      memberCount: ch._count.members,
      messageCount: ch._count.messages,
    }))
  })

  // GET /api/admin/channels/index-requests
  app.get('/channels/index-requests', async () => {
    const requests = await prisma.channelIndexRequest.findMany({
      where: { status: 'PENDING' },
      include: {
        channel: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
    const requestedByIds = [...new Set(requests.map(r => r.requestedById))]
    const userMap = Object.fromEntries(
      (await prisma.user.findMany({ where: { id: { in: requestedByIds } }, select: { id: true, displayName: true } }))
        .map(u => [u.id, u.displayName])
    )
    return requests.map(r => ({
      id: r.id, channelId: r.channelId, channelName: r.channel.name,
      requestedById: r.requestedById, requestedByName: userMap[r.requestedById] ?? 'Unknown',
      requestedVisibility: r.requestedVisibility,
      status: r.status, reviewedById: r.reviewedById, reviewedAt: r.reviewedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }))
  })

  // POST /api/admin/channels/index-requests/:id/approve
  app.post('/channels/index-requests/:id/approve', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { id } = req.params as { id: string }
    const { visibility } = (req.body ?? {}) as { visibility?: string }

    const request = await prisma.channelIndexRequest.findUnique({ where: { id } })
    if (!request) return reply.status(404).send({ error: 'Not found' })

    const approvedVisibility = (visibility ?? request.requestedVisibility) as 'PUBLIC' | 'SEMI_PUBLIC'

    await prisma.$transaction([
      prisma.channelIndexRequest.update({
        where: { id },
        data: { status: 'APPROVED', reviewedById: userId, reviewedAt: new Date() },
      }),
      prisma.channel.update({
        where: { id: request.channelId },
        data: { visibility: approvedVisibility },
      }),
    ])
    await writeAuditLog(userId, 'channel.index_approved', request.channelId, 'channel', { visibility: approvedVisibility })
    broadcastAll({ type: 'channel:visibility_changed', payload: { channelId: request.channelId, visibility: approvedVisibility } })
    return reply.status(204).send()
  })

  // POST /api/admin/channels/index-requests/:id/reject
  app.post('/channels/index-requests/:id/reject', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { id } = req.params as { id: string }

    const request = await prisma.channelIndexRequest.findUnique({ where: { id } })
    if (!request) return reply.status(404).send({ error: 'Not found' })

    await prisma.channelIndexRequest.update({
      where: { id },
      data: { status: 'REJECTED', reviewedById: userId, reviewedAt: new Date() },
    })
    await writeAuditLog(userId, 'channel.index_rejected', request.channelId, 'channel')
    return reply.status(204).send()
  })

  // PATCH /api/admin/channels/:id
  app.patch('/channels/:id', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { id } = req.params as { id: string }
    const { name, topic, isArchived, visibility } = req.body as {
      name?: string; topic?: string; isArchived?: boolean; visibility?: string
    }

    const channel = await prisma.channel.findUnique({ where: { id } })
    if (!channel) return reply.status(404).send({ error: 'Not found' })

    // Visibility changes require SUPERADMIN+
    if (visibility !== undefined) {
      const actor = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
      if (rankOf(actor?.role as UserRole ?? 'MEMBER') < rankOf('SUPERADMIN')) {
        return reply.status(403).send({ error: 'Only SUPERADMIN+ can change visibility directly' })
      }
    }

    const updated = await prisma.channel.update({
      where: { id },
      data: {
        ...(name ? { name } : {}),
        ...(topic !== undefined ? { topic: topic.trim() || null } : {}),
        ...(isArchived !== undefined ? { isArchived } : {}),
        ...(visibility ? { visibility: visibility as ChannelVisibility } : {}),
      },
    })
    await writeAuditLog(userId, 'channel.admin_update', id, 'channel', { name, topic, isArchived, visibility })
    broadcastAll({ type: 'channel:updated', payload: serializeChannel(updated) })
    if (isArchived === true) broadcastAll({ type: 'channel:archived', payload: { channelId: id } })
    if (visibility) broadcastAll({ type: 'channel:visibility_changed', payload: { channelId: id, visibility: visibility as any } })
    return reply.status(204).send()
  })

  // DELETE /api/admin/channels/:id — ADMIN+ only
  app.delete('/channels/:id', { preHandler: [requireRole('ADMIN')] }, async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { id } = req.params as { id: string }

    const channel = await prisma.channel.findUnique({ where: { id } })
    if (!channel) return reply.status(404).send({ error: 'Not found' })

    await prisma.channel.delete({ where: { id } })
    await writeAuditLog(userId, 'channel.delete', id, 'channel', { name: channel.name })
    broadcastAll({ type: 'channel:deleted', payload: { channelId: id } })
    return reply.status(204).send()
  })

  // ─── Messages ─────────────────────────────────────────────────────────────────

  // DELETE /api/admin/messages/:id — MOD+
  app.delete('/messages/:id', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { id } = req.params as { id: string }

    const message = await prisma.message.findUnique({
      where: { id },
      select: { id: true, channelId: true, content: true, authorId: true },
    })
    if (!message) return reply.status(404).send({ error: 'Not found' })

    await prisma.message.delete({ where: { id } })
    await writeAuditLog(userId, 'message.delete', id, 'message', {
      channelId: message.channelId,
      authorId: message.authorId,
      preview: message.content.slice(0, 100),
    })
    broadcastAll({ type: 'message:deleted', payload: { id: message.id, channelId: message.channelId } })
    return reply.status(204).send()
  })

  // ─── Join Requests ─────────────────────────────────────────────────────────────

  // GET /api/admin/join-requests — pending semi-public join requests
  app.get('/join-requests', async () => {
    const requests = await prisma.channelJoinRequest.findMany({
      where: { status: 'PENDING' },
      include: {
        user: { select: { id: true, username: true, displayName: true } },
        channel: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
    return requests.map(r => ({
      id: r.id, userId: r.userId, username: r.user.username, displayName: r.user.displayName,
      channelId: r.channelId, channelName: r.channel.name,
      message: r.message, status: r.status,
      reviewedById: r.reviewedById, reviewedAt: r.reviewedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }))
  })

  // POST /api/admin/join-requests/:requestId/approve
  app.post<{ Params: { requestId: string } }>(
    '/join-requests/:requestId/approve',
    { preHandler: requireRole('MODERATOR') },
    async (req, reply) => {
      const actorId = (req.user as { userId: string }).userId
      const jr = await prisma.channelJoinRequest.findUnique({ where: { id: req.params.requestId } })
      if (!jr) return reply.status(404).send({ error: 'not found' })
      if (jr.status !== 'PENDING') return reply.status(409).send({ error: 'already reviewed' })
      await prisma.$transaction([
        prisma.channelJoinRequest.update({
          where: { id: jr.id },
          data: { status: 'APPROVED', reviewedById: actorId, reviewedAt: new Date() },
        }),
        prisma.channelMember.upsert({
          where: { userId_channelId: { userId: jr.userId, channelId: jr.channelId } },
          create: { userId: jr.userId, channelId: jr.channelId },
          update: {},
        }),
      ])
      await writeAuditLog(actorId, 'join_request.approve', jr.id, 'join_request', { channelId: jr.channelId, userId: jr.userId })
      return reply.status(204).send()
    }
  )

  // POST /api/admin/join-requests/:requestId/reject
  app.post<{ Params: { requestId: string } }>(
    '/join-requests/:requestId/reject',
    { preHandler: requireRole('MODERATOR') },
    async (req, reply) => {
      const actorId = (req.user as { userId: string }).userId
      const jr = await prisma.channelJoinRequest.findUnique({ where: { id: req.params.requestId } })
      if (!jr) return reply.status(404).send({ error: 'not found' })
      if (jr.status !== 'PENDING') return reply.status(409).send({ error: 'already reviewed' })
      await prisma.channelJoinRequest.update({
        where: { id: jr.id },
        data: { status: 'REJECTED', reviewedById: actorId, reviewedAt: new Date() },
      })
      await writeAuditLog(actorId, 'join_request.reject', jr.id, 'join_request', { channelId: jr.channelId, userId: jr.userId })
      return reply.status(204).send()
    }
  )

  // ─── Password Reset Requests ──────────────────────────────────────────────────

  // GET /api/admin/password-resets — SUPERADMIN+
  app.get('/password-resets', { preHandler: [requireRole('SUPERADMIN')] }, async () => {
    const requests = await prisma.passwordResetRequest.findMany({
      where: { status: 'PENDING' },
      include: { user: { select: { id: true, username: true, displayName: true } } },
      orderBy: { createdAt: 'asc' },
    })
    return requests.map(r => ({
      id: r.id,
      userId: r.userId,
      username: r.user.username,
      displayName: r.user.displayName,
      createdAt: r.createdAt.toISOString(),
    }))
  })

  // POST /api/admin/password-resets/:id/approve — SUPERADMIN+
  app.post('/password-resets/:id/approve', { preHandler: [requireRole('SUPERADMIN')] }, async (req, reply) => {
    const { userId: actorId } = req.user as { userId: string }
    const { id } = req.params as { id: string }

    const request = await prisma.passwordResetRequest.findUnique({
      where: { id },
      include: { user: { select: { id: true, username: true, displayName: true } } },
    })
    if (!request) return reply.status(404).send({ error: 'Not found' })
    if (request.status !== 'PENDING') return reply.status(409).send({ error: 'Already reviewed' })

    await prisma.$transaction([
      prisma.user.update({
        where: { id: request.userId },
        data: { passwordHash: request.newPasswordHash, hashVersion: 'bcrypt' },
      }),
      prisma.passwordResetRequest.update({
        where: { id },
        data: { status: 'APPROVED', reviewedById: actorId, reviewedAt: new Date() },
      }),
    ])

    await writeAuditLog(actorId, 'password_reset.approved', request.userId, 'user', {
      username: request.user.username,
      requestId: id,
    })

    await createNotification(
      request.userId,
      'account:reset_approved',
      'Password reset approved',
      'Your password reset request has been approved. You can now log in with your new password.',
    )

    return reply.status(204).send()
  })

  // POST /api/admin/password-resets/:id/reject — SUPERADMIN+
  app.post('/password-resets/:id/reject', { preHandler: [requireRole('SUPERADMIN')] }, async (req, reply) => {
    const { userId: actorId } = req.user as { userId: string }
    const { id } = req.params as { id: string }

    const request = await prisma.passwordResetRequest.findUnique({
      where: { id },
      include: { user: { select: { id: true, username: true } } },
    })
    if (!request) return reply.status(404).send({ error: 'Not found' })
    if (request.status !== 'PENDING') return reply.status(409).send({ error: 'Already reviewed' })

    await prisma.passwordResetRequest.update({
      where: { id },
      data: { status: 'REJECTED', reviewedById: actorId, reviewedAt: new Date() },
    })

    await writeAuditLog(actorId, 'password_reset.rejected', request.userId, 'user', {
      username: request.user.username,
      requestId: id,
    })

    return reply.status(204).send()
  })

  // ─── Audit Log ─────────────────────────────────────────────────────────────────

  // GET /api/admin/audit?action=&actorId=&targetId=&before=&limit=50
  app.get<{
    Querystring: { action?: string; actorId?: string; targetId?: string; before?: string; limit?: string }
  }>('/audit', async (req) => {
    const { action, actorId, targetId, before, limit } = req.query
    const take = Math.min(Number(limit ?? 50), 200)

    const entries = await prisma.auditLog.findMany({
      where: {
        ...(action ? { action: { contains: action } } : {}),
        ...(actorId ? { actorId } : {}),
        ...(targetId ? { targetId } : {}),
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      include: { actor: { select: { displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take,
    })

    return entries.map(e => ({
      id: e.id,
      createdAt: e.createdAt.toISOString(),
      actorId: e.actorId,
      actorName: e.actor?.displayName ?? null,
      action: e.action,
      targetId: e.targetId,
      targetType: e.targetType,
      meta: e.meta,
    }))
  })

  // ─── Stats ─────────────────────────────────────────────────────────────────────

  // GET /api/admin/stats
  app.get('/stats', async () => {
    const [userCount, messageCount, channelCount, storageResult] = await Promise.all([
      prisma.user.count(),
      prisma.message.count({ where: { isSystem: false } }),
      prisma.channel.count({ where: { type: { notIn: ['DM', 'GROUP'] } } }),
      prisma.attachment.aggregate({ _sum: { size: true } }),
    ])
    return {
      userCount,
      messageCount,
      channelCount,
      totalAttachmentBytes: storageResult._sum.size ?? 0,
    }
  })

  // ─── Files (relocated from file-manager) ──────────────────────────────────────

  // GET /api/admin/files?sort=size|type|uploadedAt|uploader&limit=100&cursor=<id>
  app.get<{ Querystring: { sort?: string; limit?: string; cursor?: string } }>(
    '/files',
    async (req) => {
      const sort = req.query.sort ?? 'uploadedAt'
      const limit = Math.min(Number(req.query.limit ?? 100), 500)
      const cursor = req.query.cursor

      const orderBy = (() => {
        switch (sort) {
          case 'size': return { size: 'desc' as const }
          case 'type': return { mimeType: 'asc' as const }
          case 'uploader': return { uploader: { displayName: 'asc' as const } }
          default: return { uploadedAt: 'desc' as const }
        }
      })()

      const files = await prisma.attachment.findMany({
        where: { messageId: { not: null } },
        orderBy,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          uploader: { select: { displayName: true } },
          message: {
            select: { channel: { select: { id: true, name: true, type: true } } },
          },
        },
      })

      const hasMore = files.length > limit
      const page = files.slice(0, limit)
      return {
        files: page.map(f => ({
          id: f.id, filename: f.filename, mimeType: f.mimeType, size: f.size,
          uploadedAt: f.uploadedAt.toISOString(),
          uploaderName: f.uploader.displayName,
          url: `/uploads/${f.storedName}`,
          channel: f.message?.channel ?? null,
        })),
        nextCursor: hasMore ? page[page.length - 1].id : null,
      }
    }
  )

  // GET /api/admin/file-stats
  app.get('/file-stats', async () => {
    const [totalSize, fileCount] = await Promise.all([
      prisma.attachment.aggregate({ _sum: { size: true }, where: { messageId: { not: null } } }),
      prisma.attachment.count({ where: { messageId: { not: null } } }),
    ])
    const limitBytes = process.env.STORAGE_LIMIT_GB
      ? Number(process.env.STORAGE_LIMIT_GB) * 1024 * 1024 * 1024
      : null
    return {
      totalSize: totalSize._sum.size ?? 0,
      fileCount,
      limitBytes,
    }
  })
}
