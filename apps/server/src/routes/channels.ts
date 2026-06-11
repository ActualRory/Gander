import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { broadcastAll, broadcastToUser, getVoiceParticipantCounts } from '../ws/handler.js'
import { rankOf, writeAuditLog, type UserRole } from '../lib/auth.js'
import { createNotification } from '../lib/notifier.js'
import type { ChannelType, ChannelVisibility } from '@gander/shared'

function serializeChannel(ch: {
  id: string; name: string; type: string; topic: string | null
  createdAt: Date; creatorId: string | null; visibility: string; isArchived: boolean
}) {
  return {
    id: ch.id,
    name: ch.name,
    type: ch.type as ChannelType,
    topic: ch.topic,
    createdAt: ch.createdAt.toISOString(),
    creatorId: ch.creatorId,
    visibility: ch.visibility as ChannelVisibility,
    isArchived: ch.isArchived,
  }
}

export const channelRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    try { await req.jwtVerify() } catch { reply.status(401).send({ error: 'Unauthorized' }) }
  })

  // GET /api/channels — only joined channels (membership-gated sidebar feed)
  app.get('/', async (req) => {
    const { userId } = req.user as { userId: string }
    const actor = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
    const isMod = rankOf(actor?.role as UserRole ?? 'MEMBER') >= rankOf('MODERATOR')

    const memberships = await prisma.channelMember.findMany({
      where: { userId },
      include: { channel: true },
    })
    return memberships
      .filter(m => m.channel.type !== 'DM' && m.channel.type !== 'GROUP')
      .filter(m => isMod || !m.channel.isArchived)
      .map(m => serializeChannel(m.channel))
  })

  // GET /api/channels/index — all public-index channels with stats
  app.get('/index', async (req) => {
    const { userId } = req.user as { userId: string }

    const channels = await prisma.channel.findMany({
      where: {
        type: { notIn: ['DM', 'GROUP'] },
        visibility: { not: 'PRIVATE' },
        isArchived: false,
      },
      include: {
        _count: { select: { members: true, messages: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    const memberChannelIds = new Set(
      (await prisma.channelMember.findMany({ where: { userId }, select: { channelId: true } }))
        .map(m => m.channelId)
    )
    const pendingRequests = new Set(
      (await prisma.channelJoinRequest.findMany({
        where: { userId, status: 'PENDING' },
        select: { channelId: true },
      })).map(r => r.channelId)
    )

    const voiceCounts = getVoiceParticipantCounts()

    return channels.map(ch => ({
      id: ch.id,
      name: ch.name,
      type: ch.type,
      topic: ch.topic,
      createdAt: ch.createdAt.toISOString(),
      visibility: ch.visibility,
      memberCount: ch._count.members,
      messageCount: ch._count.messages,
      liveParticipantCount: voiceCounts[ch.id] ?? 0,
      isMember: memberChannelIds.has(ch.id),
      hasPendingJoinRequest: pendingRequests.has(ch.id),
    }))
  })

  // GET /api/channels/read
  app.get('/read', async (req) => {
    const { userId } = req.user as { userId: string }
    const rows = await prisma.userChannelRead.findMany({ where: { userId } })
    return rows.map(r => ({ channelId: r.channelId, lastReadAt: r.lastReadAt.toISOString() }))
  })

  // POST /api/channels/read
  app.post('/read', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { reads } = req.body as { reads: Array<{ channelId: string; lastReadAt: string }> }
    if (!Array.isArray(reads) || reads.length === 0) return reply.status(204).send()

    await Promise.all(reads.map(({ channelId, lastReadAt }) =>
      prisma.userChannelRead.upsert({
        where: { userId_channelId: { userId, channelId } },
        create: { userId, channelId, lastReadAt: new Date(lastReadAt) },
        update: { lastReadAt: new Date(lastReadAt) },
      })
    ))
    for (const { channelId, lastReadAt } of reads) {
      broadcastToUser(userId, { type: 'channel:read', payload: { channelId, lastReadAt } })
    }
    return reply.status(204).send()
  })

  // POST /api/channels — create a new private channel
  app.post('/', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { name, type } = req.body as { name: string; type: 'TEXT' | 'VOICE' }

    const channel = await prisma.channel.create({
      data: {
        name,
        type,
        creatorId: userId,
        visibility: 'PRIVATE',
        members: { create: { userId, role: 'MANAGER' } },
      },
    })
    // Only broadcast to creator — channel is private
    broadcastToUser(userId, { type: 'channel:created', payload: serializeChannel(channel) })
    return reply.status(201).send(serializeChannel(channel))
  })

  // POST /api/channels/:channelId/join
  app.post('/:channelId/join', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { channelId } = req.params as { channelId: string }
    const { message } = (req.body ?? {}) as { message?: string }

    const channel = await prisma.channel.findUnique({ where: { id: channelId } })
    if (!channel) return reply.status(404).send({ error: 'Not found' })
    if (channel.isArchived) return reply.status(410).send({ error: 'Channel is archived' })

    if (channel.visibility === 'PRIVATE') {
      return reply.status(403).send({ error: 'This channel is invite-only' })
    }

    if (channel.visibility === 'SEMI_PUBLIC') {
      // Check if already a member
      const existing = await prisma.channelMember.findUnique({
        where: { userId_channelId: { userId, channelId } },
      })
      if (existing) return reply.status(204).send()

      // Upsert pending join request
      await prisma.channelJoinRequest.upsert({
        where: { userId_channelId: { userId, channelId } },
        create: { userId, channelId, message: message?.trim() || null },
        update: { message: message?.trim() || null, status: 'PENDING', reviewedById: null, reviewedAt: null },
      })
      return reply.status(202).send({ status: 'pending' })
    }

    // PUBLIC or DEFAULT — immediate join
    await prisma.channelMember.upsert({
      where: { userId_channelId: { userId, channelId } },
      create: { userId, channelId },
      update: {},
    })
    broadcastToUser(userId, { type: 'channel:created', payload: serializeChannel(channel) })
    return reply.status(204).send()
  })

  // POST /api/channels/:channelId/join-requests/:requestId/approve
  app.post('/:channelId/join-requests/:requestId/approve', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { channelId, requestId } = req.params as { channelId: string; requestId: string }

    const actor = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
    const isMod = rankOf(actor?.role as UserRole ?? 'MEMBER') >= rankOf('MODERATOR')

    // Allow if global mod or channel manager
    if (!isMod) {
      const membership = await prisma.channelMember.findUnique({
        where: { userId_channelId: { userId, channelId } },
      })
      if (membership?.role !== 'MANAGER') return reply.status(403).send({ error: 'Forbidden' })
    }

    const joinRequest = await prisma.channelJoinRequest.findUnique({ where: { id: requestId } })
    if (!joinRequest || joinRequest.channelId !== channelId) return reply.status(404).send({ error: 'Not found' })

    await prisma.$transaction([
      prisma.channelJoinRequest.update({
        where: { id: requestId },
        data: { status: 'APPROVED', reviewedById: userId, reviewedAt: new Date() },
      }),
      prisma.channelMember.upsert({
        where: { userId_channelId: { userId: joinRequest.userId, channelId } },
        create: { userId: joinRequest.userId, channelId },
        update: {},
      }),
    ])

    const channel = await prisma.channel.findUnique({ where: { id: channelId } })
    if (channel) broadcastToUser(joinRequest.userId, { type: 'channel:created', payload: serializeChannel(channel) })
    return reply.status(204).send()
  })

  // POST /api/channels/:channelId/join-requests/:requestId/reject
  app.post('/:channelId/join-requests/:requestId/reject', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { channelId, requestId } = req.params as { channelId: string; requestId: string }

    const actor = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
    const isMod = rankOf(actor?.role as UserRole ?? 'MEMBER') >= rankOf('MODERATOR')

    if (!isMod) {
      const membership = await prisma.channelMember.findUnique({
        where: { userId_channelId: { userId, channelId } },
      })
      if (membership?.role !== 'MANAGER') return reply.status(403).send({ error: 'Forbidden' })
    }

    await prisma.channelJoinRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED', reviewedById: userId, reviewedAt: new Date() },
    })
    return reply.status(204).send()
  })

  // POST /api/channels/:channelId/index-request — request channel be listed in public index
  app.post('/:channelId/index-request', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { channelId } = req.params as { channelId: string }
    const { visibility } = req.body as { visibility: 'PUBLIC' | 'SEMI_PUBLIC' }

    if (!['PUBLIC', 'SEMI_PUBLIC'].includes(visibility)) {
      return reply.status(400).send({ error: 'Invalid visibility. Must be PUBLIC or SEMI_PUBLIC' })
    }

    const channel = await prisma.channel.findUnique({ where: { id: channelId } })
    if (!channel) return reply.status(404).send({ error: 'Not found' })
    if (channel.creatorId !== userId) return reply.status(403).send({ error: 'Forbidden' })

    const existing = await prisma.channelIndexRequest.findUnique({ where: { channelId } })
    if (existing && existing.status === 'PENDING') {
      return reply.status(409).send({ error: 'An index request is already pending' })
    }

    const actor = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
    const isSuperAdmin = rankOf(actor?.role as UserRole ?? 'MEMBER') >= rankOf('SUPERADMIN')

    if (isSuperAdmin) {
      // Skip approval — apply immediately
      await prisma.channel.update({ where: { id: channelId }, data: { visibility } })
      broadcastAll({ type: 'channel:visibility_changed', payload: { channelId, visibility } })
      return reply.status(204).send()
    }

    await prisma.channelIndexRequest.upsert({
      where: { channelId },
      create: { channelId, requestedById: userId, requestedVisibility: visibility },
      update: { requestedVisibility: visibility, status: 'PENDING', reviewedById: null, reviewedAt: null },
    })
    return reply.status(202).send({ status: 'pending' })
  })

  // PATCH /api/channels/:channelId
  app.patch('/:channelId', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { channelId } = req.params as { channelId: string }
    const { name, topic, isArchived } = req.body as { name?: string; topic?: string; isArchived?: boolean }

    if (name === undefined && topic === undefined && isArchived === undefined) {
      return reply.status(400).send({ error: 'Nothing to update' })
    }

    const channel = await prisma.channel.findUnique({ where: { id: channelId } })
    if (!channel) return reply.status(404).send({ error: 'Not found' })

    const actor = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
    const isMod = rankOf(actor?.role as UserRole ?? 'MEMBER') >= rankOf('MODERATOR')
    if (channel.creatorId !== userId && !isMod) return reply.status(403).send({ error: 'Forbidden' })

    const updated = await prisma.channel.update({
      where: { id: channelId },
      data: {
        ...(name ? { name } : {}),
        ...(topic !== undefined ? { topic: topic.trim() || null } : {}),
        ...(isArchived !== undefined ? { isArchived } : {}),
      },
    })

    broadcastAll({ type: 'channel:updated', payload: serializeChannel(updated) })
    if (isArchived === true) broadcastAll({ type: 'channel:archived', payload: { channelId } })

    if (topic !== undefined && (topic.trim() || null) !== channel.topic) {
      const actorUser = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } })
      if (actorUser) {
        const content = JSON.stringify({ type: 'topic_changed', from: channel.topic ?? null, to: topic.trim() || null })
        const sysMsg = await prisma.message.create({
          data: { content, channelId, authorId: userId, isSystem: true },
        })
        broadcastAll({
          type: 'message:new',
          payload: {
            id: sysMsg.id, channelId, authorId: userId, authorName: actorUser.displayName,
            content, createdAt: sysMsg.createdAt.toISOString(), editedAt: null, postNumber: null,
            replyTo: null, reactions: [], mentions: [], attachments: [], isSystem: true,
          },
        })
      }
    }

    return serializeChannel(updated)
  })

  // DELETE /api/channels/:channelId
  app.delete('/:channelId', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { channelId } = req.params as { channelId: string }

    const channel = await prisma.channel.findUnique({ where: { id: channelId } })
    if (!channel) return reply.status(404).send({ error: 'Not found' })

    const actor = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
    const isAdmin = rankOf(actor?.role as UserRole ?? 'MEMBER') >= rankOf('ADMIN')
    const isCreatorOfPrivate = channel.creatorId === userId && channel.visibility === 'PRIVATE'
    if (!isAdmin && !isCreatorOfPrivate) return reply.status(403).send({ error: 'Forbidden' })

    await prisma.channel.delete({ where: { id: channelId } })
    await writeAuditLog(userId, 'channel.delete', channelId, 'channel', { name: channel.name })
    broadcastAll({ type: 'channel:deleted', payload: { channelId } })
    return reply.status(204).send()
  })

  // DELETE /api/channels/:channelId/membership — leave a channel
  app.delete('/:channelId/membership', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { channelId } = req.params as { channelId: string }
    const channel = await prisma.channel.findUnique({ where: { id: channelId } })
    if (!channel) return reply.status(404).send({ error: 'Not found' })
    if (channel.type === 'DM' || channel.type === 'GROUP') return reply.status(400).send({ error: 'Cannot leave DM channels' })
    await prisma.channelMember.deleteMany({ where: { userId, channelId } })
    return reply.status(204).send()
  })

  // GET /api/channels/:channelId/members — list members (members and mods only)
  app.get('/:channelId/members', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { channelId } = req.params as { channelId: string }

    const [actor, membership] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
      prisma.channelMember.findUnique({ where: { userId_channelId: { userId, channelId } } }),
    ])
    const isMod = rankOf(actor?.role as UserRole ?? 'MEMBER') >= rankOf('MODERATOR')
    if (!membership && !isMod) return reply.status(403).send({ error: 'Forbidden' })

    const members = await prisma.channelMember.findMany({
      where: { channelId },
      select: { userId: true, role: true, joinedAt: true },
      orderBy: { joinedAt: 'asc' },
    })
    return members.map(m => ({ userId: m.userId, role: m.role, joinedAt: m.joinedAt.toISOString() }))
  })

  // POST /api/channels/:channelId/invite — add another user to a channel you're in
  app.post('/:channelId/invite', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { channelId } = req.params as { channelId: string }
    const { userId: targetId } = req.body as { userId: string }
    if (!targetId) return reply.status(400).send({ error: 'userId required' })

    const channel = await prisma.channel.findUnique({ where: { id: channelId } })
    if (!channel) return reply.status(404).send({ error: 'Not found' })
    if (channel.type === 'DM' || channel.type === 'GROUP') return reply.status(400).send({ error: 'Cannot invite to DM channels' })
    if (channel.isArchived) return reply.status(410).send({ error: 'Channel is archived' })

    const [actor, inviterMembership, target, existing] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { role: true, displayName: true } }),
      prisma.channelMember.findUnique({ where: { userId_channelId: { userId, channelId } } }),
      prisma.user.findUnique({ where: { id: targetId }, select: { isBanned: true, isArchived: true } }),
      prisma.channelMember.findUnique({ where: { userId_channelId: { userId: targetId, channelId } } }),
    ])
    const isMod = rankOf(actor?.role as UserRole ?? 'MEMBER') >= rankOf('MODERATOR')
    if (!inviterMembership && !isMod) return reply.status(403).send({ error: 'You must be a member to invite others' })
    if (!target) return reply.status(404).send({ error: 'User not found' })
    if (target.isBanned || target.isArchived) return reply.status(400).send({ error: 'Cannot invite this user' })
    if (existing) return reply.status(409).send({ error: 'Already a member' })

    await prisma.channelMember.create({ data: { userId: targetId, channelId } })
    await writeAuditLog(userId, 'channel.invite', channelId, 'channel', { invitedUserId: targetId })

    // Target's sidebar picks the channel up via channel:created
    broadcastToUser(targetId, { type: 'channel:created', payload: serializeChannel(channel) })
    await createNotification(
      targetId,
      'channel_invite',
      `${actor?.displayName ?? 'Someone'} invited you to #${channel.name}`,
      channel.topic ?? undefined,
      { channelId },
    )
    return reply.status(204).send()
  })

  // GET /api/channels/:channelId/preview
  app.get('/:channelId/preview', async (req, reply) => {
    const { channelId } = req.params as { channelId: string }
    const channel = await prisma.channel.findUnique({ where: { id: channelId } })
    if (!channel) return reply.status(404).send({ error: 'Not found' })
    const messageCount = await prisma.message.count({ where: { channelId, isSystem: false } })
    return { id: channel.id, name: channel.name, type: channel.type, topic: channel.topic, messageCount }
  })

  // GET /api/channels/:channelId/pins
  app.get('/:channelId/pins', async (req) => {
    const { channelId } = req.params as { channelId: string }
    const pins = await prisma.pinnedMessage.findMany({
      where: { channelId },
      include: {
        message: {
          include: {
            author: { select: { id: true, displayName: true } },
            attachments: { select: { id: true, storedName: true, mimeType: true, filename: true, size: true } },
          },
        },
      },
      orderBy: { pinnedAt: 'desc' },
    })
    return pins.map(p => ({
      id: p.id,
      messageId: p.messageId,
      channelId: p.channelId,
      pinnedAt: p.pinnedAt.toISOString(),
      pinnedBy: p.pinnedBy,
      message: {
        id: p.message.id,
        channelId: p.message.channelId,
        authorId: p.message.authorId,
        authorName: p.message.author.displayName,
        content: p.message.content,
        createdAt: p.message.createdAt.toISOString(),
        postNumber: p.message.postNumber,
        attachments: p.message.attachments.map(a => ({
          id: a.id,
          url: `/uploads/${a.storedName}`,
          mimeType: a.mimeType,
          filename: a.filename,
          size: a.size,
        })),
      },
    }))
  })

  // POST /api/channels/:channelId/pins/:messageId
  app.post('/:channelId/pins/:messageId', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { channelId, messageId } = req.params as { channelId: string; messageId: string }

    const existing = await prisma.pinnedMessage.findUnique({
      where: { channelId_messageId: { channelId, messageId } },
    })

    await prisma.pinnedMessage.upsert({
      where: { channelId_messageId: { channelId, messageId } },
      create: { channelId, messageId, pinnedBy: userId },
      update: {},
    })

    if (!existing) {
      const [pinner, pinnedMsg, channel] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } }),
        prisma.message.findUnique({ where: { id: messageId }, select: { content: true, author: { select: { displayName: true } } } }),
        prisma.channel.findUnique({ where: { id: channelId }, select: { type: true } }),
      ])
      if (pinner && pinnedMsg) {
        const sysMsg = await prisma.message.create({
          data: { content: 'pinned', channelId, authorId: userId, replyToId: messageId, isSystem: true },
        })
        const isDm = channel?.type === 'DM' || channel?.type === 'GROUP'
        const outEvent = {
          type: 'message:new' as const,
          payload: {
            id: sysMsg.id, channelId, authorId: userId, authorName: pinner.displayName,
            content: 'pinned', createdAt: sysMsg.createdAt.toISOString(), editedAt: null,
            postNumber: null,
            replyTo: { id: messageId, authorName: pinnedMsg.author.displayName, content: pinnedMsg.content.slice(0, 100) || '[image]' },
            reactions: [], mentions: [], attachments: [], isSystem: true,
          },
        }
        if (isDm) {
          const members = await prisma.channelMember.findMany({ where: { channelId }, select: { userId: true } })
          for (const { userId: memberId } of members) broadcastToUser(memberId, outEvent)
        } else {
          broadcastAll(outEvent)
        }
      }
    }

    return reply.status(204).send()
  })

  // DELETE /api/channels/:channelId/pins/:messageId
  app.delete('/:channelId/pins/:messageId', async (req, reply) => {
    const { channelId, messageId } = req.params as { channelId: string; messageId: string }
    await prisma.pinnedMessage.deleteMany({ where: { channelId, messageId } })
    return reply.status(204).send()
  })
}
