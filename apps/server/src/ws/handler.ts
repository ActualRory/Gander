import type { WebSocket } from '@fastify/websocket'
import type { FastifyRequest } from 'fastify'
import type { ClientEvent, ServerEvent } from '@gander/shared'
import { prisma } from '../lib/prisma.js'

// channelId → set of connected sockets (text channel rooms)
const rooms = new Map<string, Set<WebSocket>>()

// userId → set of connected sockets (supports multiple devices)
const connectedUsers = new Map<string, Set<WebSocket>>()

// Voice presence: channelId → set of userIds currently in that voice channel
const voiceRooms = new Map<string, Set<string>>()

// userId → channelId (which voice channel they're currently in)
const userVoiceChannel = new Map<string, string>()

// userId → current mute/deafen/video state
const userVoiceState = new Map<string, { muted: boolean; deafened: boolean; videoEnabled: boolean; screenSharing: boolean }>()

// channelId → epoch ms when first user joined (cleared when last user leaves)
const voiceChannelStartTimes = new Map<string, number>()

// userId → current VoiceSession DB id
const userVoiceSessionId = new Map<string, string>()

// channelId → Map<userId, expiry timer>
const channelTyping = new Map<string, Map<string, ReturnType<typeof setTimeout>>>()

// userId → current rich presence activity string
const userActivity = new Map<string, string>()

function clearTyping(channelId: string, userId: string) {
  const typers = channelTyping.get(channelId)
  if (!typers) return
  const timer = typers.get(userId)
  if (timer) clearTimeout(timer)
  typers.delete(userId)
  if (typers.size === 0) channelTyping.delete(channelId)
  broadcast(channelId, { type: 'typing:update', payload: { channelId, userIds: [...(channelTyping.get(channelId)?.keys() ?? [])] } })
}

export function broadcast(channelId: string, event: ServerEvent, exclude?: WebSocket) {
  const room = rooms.get(channelId)
  if (!room) return
  const data = JSON.stringify(event)
  for (const socket of room) {
    if (socket !== exclude && socket.readyState === socket.OPEN) {
      socket.send(data)
    }
  }
}

export function broadcastAll(event: ServerEvent, exclude?: WebSocket) {
  const data = JSON.stringify(event)
  for (const sockets of connectedUsers.values()) {
    for (const socket of sockets) {
      if (socket !== exclude && socket.readyState === socket.OPEN) {
        socket.send(data)
      }
    }
  }
}

export function broadcastToUser(userId: string, event: ServerEvent) {
  const sockets = connectedUsers.get(userId)
  if (!sockets) return
  const data = JSON.stringify(event)
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(data)
    }
  }
}

export function getVoiceParticipantCounts(): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [channelId, members] of voiceRooms) {
    if (members.size > 0) result[channelId] = members.size
  }
  return result
}

export function forceDisconnectUser(userId: string) {
  const sockets = connectedUsers.get(userId)
  if (!sockets) return
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) socket.close(4003, 'Banned')
  }
}

export async function wsHandler(socket: WebSocket, req: FastifyRequest) {
  let userId: string | null = null
  const joinedChannels = new Set<string>()

  socket.on('message', async (raw: Buffer) => {
    let event: ClientEvent
    try {
      event = JSON.parse(raw.toString()) as ClientEvent
    } catch {
      return
    }

    // Authenticate on first message (client sends its JWT)
    if (!userId) {
      // Expect client to send { type: 'auth', token: '...' } first
      const msg = event as unknown as { type: string; token: string }
      if (msg.type !== 'auth') return
      try {
        const payload = req.server.jwt.verify<{ userId: string }>(msg.token)
        userId = payload.userId
        let userSockets = connectedUsers.get(userId)
        if (!userSockets) {
          userSockets = new Set()
          connectedUsers.set(userId, userSockets)
        }
        userSockets.add(socket)
        // Send current online list to the newly connected client
        socket.send(JSON.stringify({
          type: 'users:init',
          payload: { onlineUserIds: [...connectedUsers.keys()] },
        }))
        // Send current voice room state
        const voiceRoomsSnapshot: Record<string, string[]> = {}
        for (const [channelId, members] of voiceRooms) {
          if (members.size > 0) voiceRoomsSnapshot[channelId] = [...members]
        }
        const voiceStatesSnapshot: Record<string, { muted: boolean; deafened: boolean; videoEnabled: boolean; screenSharing: boolean }> = {}
        for (const [uid, state] of userVoiceState) {
          voiceStatesSnapshot[uid] = state
        }
        const voiceStartTimesSnapshot: Record<string, number> = {}
        for (const [channelId, startTime] of voiceChannelStartTimes) {
          voiceStartTimesSnapshot[channelId] = startTime
        }
        socket.send(JSON.stringify({
          type: 'voice:init',
          payload: { voiceRooms: voiceRoomsSnapshot, voiceStates: voiceStatesSnapshot, voiceChannelStartTimes: voiceStartTimesSnapshot },
        }))
        // Send current activity strings to the newly connected client
        socket.send(JSON.stringify({
          type: 'activity:init',
          payload: { activities: Object.fromEntries(userActivity) },
        }))
        // Notify all other clients this user came online (only for first connection)
        if (userSockets.size === 1) {
          const connectedUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, username: true, displayName: true, subtitle: true, avatarUrl: true, createdAt: true, lastSeenAt: true, role: true, isBanned: true, timeoutUntil: true },
          })
          if (connectedUser) {
            broadcastAll({
              type: 'user:online',
              payload: {
                userId,
                user: { ...connectedUser, role: connectedUser.role as import('@gander/shared').UserRole, createdAt: connectedUser.createdAt.toISOString(), lastSeenAt: connectedUser.lastSeenAt?.toISOString() ?? null, timeoutUntil: connectedUser.timeoutUntil?.toISOString() ?? null },
              },
            }, socket)
          }
        }
      } catch {
        socket.close(4001, 'Unauthorized')
      }
      return
    }

    try { switch (event.type) {
      case 'channel:join': {
        const { channelId } = event.payload
        if (!rooms.has(channelId)) rooms.set(channelId, new Set())
        rooms.get(channelId)!.add(socket)
        joinedChannels.add(channelId)
        broadcast(channelId, { type: 'presence:join', payload: { userId, channelId } }, socket)
        break
      }

      case 'channel:leave': {
        const { channelId } = event.payload
        rooms.get(channelId)?.delete(socket)
        joinedChannels.delete(channelId)
        broadcast(channelId, { type: 'presence:leave', payload: { userId, channelId } })
        break
      }

      case 'voice:join': {
        const { channelId } = event.payload
        // Leave any current voice channel first
        const prevChannelId = userVoiceChannel.get(userId)
        if (prevChannelId) {
          voiceRooms.get(prevChannelId)?.delete(userId)
          if ((voiceRooms.get(prevChannelId)?.size ?? 0) === 0) {
            voiceChannelStartTimes.delete(prevChannelId)
          }
          broadcastAll({ type: 'voice:leave', payload: { userId, channelId: prevChannelId } })
          const prevSessionId = userVoiceSessionId.get(userId)
          if (prevSessionId) {
            await prisma.voiceSession.update({ where: { id: prevSessionId }, data: { leftAt: new Date() } }).catch(() => {})
            userVoiceSessionId.delete(userId)
          }
        }
        if (!voiceRooms.has(channelId)) voiceRooms.set(channelId, new Set())
        const wasEmpty = voiceRooms.get(channelId)!.size === 0
        voiceRooms.get(channelId)!.add(userId)
        userVoiceChannel.set(userId, channelId)
        if (wasEmpty) voiceChannelStartTimes.set(channelId, Date.now())
        const startTime = voiceChannelStartTimes.get(channelId)!
        broadcastAll({ type: 'voice:join', payload: { userId, channelId, startTime } })
        const session = await prisma.voiceSession.create({ data: { userId, channelId } }).catch(() => null)
        if (session) userVoiceSessionId.set(userId, session.id)
        break
      }

      case 'voice:leave': {
        const { channelId } = event.payload
        voiceRooms.get(channelId)?.delete(userId)
        if ((voiceRooms.get(channelId)?.size ?? 0) === 0) {
          voiceChannelStartTimes.delete(channelId)
        }
        userVoiceChannel.delete(userId)
        userVoiceState.delete(userId)
        broadcastAll({ type: 'voice:leave', payload: { userId, channelId } })
        const sessionId = userVoiceSessionId.get(userId)
        if (sessionId) {
          await prisma.voiceSession.update({ where: { id: sessionId }, data: { leftAt: new Date() } }).catch(() => {})
          userVoiceSessionId.delete(userId)
        }
        break
      }

      case 'voice:state': {
        const { muted, deafened, videoEnabled = false, screenSharing = false } = event.payload
        userVoiceState.set(userId, { muted, deafened, videoEnabled, screenSharing })
        broadcastAll({ type: 'voice:state', payload: { userId, muted, deafened, videoEnabled, screenSharing } })
        break
      }

      case 'activity:update': {
        const { activity } = event.payload
        userActivity.set(userId, activity)
        broadcastAll({ type: 'activity:update', payload: { userId, activity } }, socket)
        break
      }

      case 'typing:start': {
        const { channelId } = event.payload
        if (!channelTyping.has(channelId)) channelTyping.set(channelId, new Map())
        const typers = channelTyping.get(channelId)!
        const existing = typers.get(userId)
        if (existing) clearTimeout(existing)
        const timer = setTimeout(() => clearTyping(channelId, userId!), 5000)
        typers.set(userId, timer)
        broadcast(channelId, { type: 'typing:update', payload: { channelId, userIds: [...typers.keys()] } })
        break
      }

      case 'message:send': {
        const { channelId, content, replyToId, attachmentIds, tempId } = event.payload
        // Reject timed-out or banned users
        const sender = await prisma.user.findUnique({
          where: { id: userId },
          select: { isBanned: true, timeoutUntil: true },
        })
        if (sender?.isBanned) { socket.close(4003, 'Banned'); return }
        if (sender?.timeoutUntil && sender.timeoutUntil > new Date()) return
        // Clear typing indicator when message is sent
        clearTyping(channelId, userId)
        const hasContent = content.trim().length > 0
        const hasAttachments = Array.isArray(attachmentIds) && attachmentIds.length > 0
        if (!hasContent && !hasAttachments) return

        const [author, channel] = await Promise.all([
          prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } }),
          prisma.channel.findUnique({ where: { id: channelId }, select: { type: true } }),
        ])
        if (!author) return

        let replyTo: { id: string; authorName: string; content: string } | null = null
        if (replyToId) {
          const original = await prisma.message.findUnique({
            where: { id: replyToId },
            select: { id: true, content: true, author: { select: { displayName: true } } },
          })
          if (original) {
            replyTo = {
              id: original.id,
              authorName: original.author.displayName,
              content: original.content.slice(0, 100) || '[image]',
            }
          }
        }

        // Parse @username mentions from content
        const mentionHandles = [...content.matchAll(/@(\S+)/g)].map(m => m[1])
        const mentionedUsers = mentionHandles.length > 0
          ? await prisma.user.findMany({
              where: { username: { in: mentionHandles, mode: 'insensitive' } },
              select: { id: true },
            })
          : []
        // Don't count self-mentions
        const mentionedUserIds = mentionedUsers.map(u => u.id).filter(id => id !== userId)

        const isDm = channel?.type === 'DM' || channel?.type === 'GROUP'

        // Retry loop to handle postNumber unique-constraint races
        let message: Awaited<ReturnType<typeof prisma.message.create>> | null = null
        let postNumber: number | null = null
        for (let attempt = 0; attempt < 3; attempt++) {
          postNumber = null
          if (!isDm) {
            const { _max } = await prisma.message.aggregate({ _max: { postNumber: true } })
            postNumber = (_max.postNumber ?? 0) + 1
          }
          try {
            message = await prisma.message.create({
              data: {
                content,
                channelId,
                authorId: userId,
                postNumber,
                ...(replyToId ? { replyToId } : {}),
                ...(mentionedUserIds.length > 0 ? {
                  mentions: { createMany: { data: mentionedUserIds.map(uid => ({ userId: uid })), skipDuplicates: true } },
                } : {}),
              },
            })
            break
          } catch (err: unknown) {
            // Retry on unique constraint violation (postNumber race)
            const code = err && typeof err === 'object' && 'code' in err ? (err as { code: string }).code : ''
            if (code === 'P2002' && attempt < 2) continue
            throw err
          }
        }
        if (!message) return

        // Notify mentioned users (skip self-mentions, fire-and-forget)
        if (mentionedUserIds.length > 0 && author) {
          const preview = content.slice(0, 100)
          const locationHint = isDm ? 'in a DM' : `(#${postNumber})`
          const notifTitle = `${author.displayName} mentioned you`
          const notifBody = preview + (locationHint ? ` ${locationHint}` : '')
          const notifMeta = { messageId: message.id, channelId, postNumber }
          for (const mentionedId of mentionedUserIds) {
            prisma.notification.create({
              data: { userId: mentionedId, type: 'mention', title: notifTitle, body: notifBody, meta: notifMeta as never },
            }).then((notif: { id: string; type: string; title: string; body: string | null; meta: unknown; read: boolean; createdAt: Date }) => {
              broadcastToUser(mentionedId, {
                type: 'notification:new',
                payload: {
                  id: notif.id, type: notif.type, title: notif.title,
                  body: notif.body ?? null, meta: notif.meta as Record<string, unknown> | null,
                  read: notif.read, createdAt: notif.createdAt.toISOString(),
                },
              })
            }).catch(() => {})
          }
        }

        // Link attachments (only the uploader's unlinked ones)
        let attachments: Array<{ id: string; storedName: string; mimeType: string; filename: string; size: number }> = []
        if (hasAttachments) {
          const safeIds = attachmentIds!.slice(0, 5)
          await prisma.attachment.updateMany({
            where: { id: { in: safeIds }, uploaderId: userId, messageId: null },
            data: { messageId: message.id },
          })
          attachments = await prisma.attachment.findMany({
            where: { messageId: message.id },
            select: { id: true, storedName: true, mimeType: true, filename: true, size: true },
          })
        }

        const outEvent: ServerEvent = {
          type: 'message:new',
          payload: {
            id: message.id,
            channelId,
            authorId: userId,
            authorName: author.displayName,
            content: message.content,
            createdAt: message.createdAt.toISOString(),
            editedAt: null,
            postNumber,
            replyTo,
            reactions: [],
            mentions: mentionedUserIds,
            attachments: attachments.map(a => ({
              id: a.id,
              url: `/uploads/${a.storedName}`,
              mimeType: a.mimeType,
              filename: a.filename,
              size: a.size,
            })),
            isSystem: false,
            ...(tempId ? { tempId } : {}),
          },
        }

        if (isDm) {
          // DM/GROUP: deliver only to channel members
          const members = await prisma.channelMember.findMany({
            where: { channelId },
            select: { userId: true },
          })
          for (const { userId: memberId } of members) {
            broadcastToUser(memberId, outEvent)
          }
        } else {
          // TEXT: deliver to all connected users (everyone can see all text channels)
          broadcastAll(outEvent)
        }
        break
      }
    } } catch (err) {
      console.error('[ws] handler error:', err)
    }
  })

  socket.on('close', async () => {
    if (userId) {
      const userSockets = connectedUsers.get(userId)
      if (userSockets) {
        userSockets.delete(socket)
        if (userSockets.size === 0) connectedUsers.delete(userId)
      }
      // Clean up channel rooms this socket joined
      for (const channelId of joinedChannels) {
        rooms.get(channelId)?.delete(socket)
      }
      // Only broadcast offline/cleanup when ALL sockets for this user are gone
      if (!connectedUsers.has(userId)) {
        userActivity.delete(userId)
        // Clean up any typing indicators for this user
        for (const [channelId] of channelTyping) {
          clearTyping(channelId, userId)
        }
        const now = new Date()
        await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: now } }).catch(() => {})
        broadcastAll({ type: 'user:offline', payload: { userId, lastSeenAt: now.toISOString() } })
        // Auto-leave voice channel on disconnect
        const voiceChannelId = userVoiceChannel.get(userId)
        if (voiceChannelId) {
          voiceRooms.get(voiceChannelId)?.delete(userId)
          if ((voiceRooms.get(voiceChannelId)?.size ?? 0) === 0) {
            voiceChannelStartTimes.delete(voiceChannelId)
          }
          userVoiceChannel.delete(userId)
          userVoiceState.delete(userId)
          broadcastAll({ type: 'voice:leave', payload: { userId, channelId: voiceChannelId } })
          const sessionId = userVoiceSessionId.get(userId)
          if (sessionId) {
            await prisma.voiceSession.update({ where: { id: sessionId }, data: { leftAt: new Date() } }).catch(() => {})
            userVoiceSessionId.delete(userId)
          }
        }
        for (const channelId of joinedChannels) {
          broadcast(channelId, { type: 'presence:leave', payload: { userId, channelId } })
        }
      }
    }
  })
}
