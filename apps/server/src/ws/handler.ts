import type { WebSocket } from '@fastify/websocket'
import type { FastifyRequest } from 'fastify'
import type { ClientEvent, ServerEvent } from '@gander/shared'
import { prisma } from '../lib/prisma.js'

// channelId → set of connected sockets (text channel rooms)
const rooms = new Map<string, Set<WebSocket>>()

// userId → socket (global presence)
const connectedUsers = new Map<string, WebSocket>()

// Voice presence: channelId → set of userIds currently in that voice channel
const voiceRooms = new Map<string, Set<string>>()

// userId → channelId (which voice channel they're currently in)
const userVoiceChannel = new Map<string, string>()

// userId → current mute/deafen/video state
const userVoiceState = new Map<string, { muted: boolean; deafened: boolean; videoEnabled: boolean; screenSharing: boolean }>()

// channelId → epoch ms when first user joined (cleared when last user leaves)
const voiceChannelStartTimes = new Map<string, number>()

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
  for (const socket of connectedUsers.values()) {
    if (socket !== exclude && socket.readyState === socket.OPEN) {
      socket.send(data)
    }
  }
}

export function broadcastToUser(userId: string, event: ServerEvent) {
  const socket = connectedUsers.get(userId)
  if (socket && socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(event))
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
        connectedUsers.set(userId, socket)
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
        // Notify all other clients this user came online (include user data so new users are discoverable)
        const connectedUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, username: true, displayName: true, subtitle: true, createdAt: true, lastSeenAt: true },
        })
        if (connectedUser) {
          broadcastAll({
            type: 'user:online',
            payload: {
              userId,
              user: { ...connectedUser, createdAt: connectedUser.createdAt.toISOString(), lastSeenAt: connectedUser.lastSeenAt?.toISOString() ?? null },
            },
          }, socket)
        }
      } catch {
        socket.close(4001, 'Unauthorized')
      }
      return
    }

    switch (event.type) {
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
        }
        if (!voiceRooms.has(channelId)) voiceRooms.set(channelId, new Set())
        const wasEmpty = voiceRooms.get(channelId)!.size === 0
        voiceRooms.get(channelId)!.add(userId)
        userVoiceChannel.set(userId, channelId)
        if (wasEmpty) voiceChannelStartTimes.set(channelId, Date.now())
        const startTime = voiceChannelStartTimes.get(channelId)!
        broadcastAll({ type: 'voice:join', payload: { userId, channelId, startTime } })
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
        break
      }

      case 'voice:state': {
        const { muted, deafened, videoEnabled = false, screenSharing = false } = event.payload
        userVoiceState.set(userId, { muted, deafened, videoEnabled, screenSharing })
        broadcastAll({ type: 'voice:state', payload: { userId, muted, deafened, videoEnabled, screenSharing } })
        break
      }

      case 'message:send': {
        const { channelId, content, replyToId, attachmentIds } = event.payload
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
        let postNumber: number | null = null
        if (!isDm) {
          const { _max } = await prisma.message.aggregate({ _max: { postNumber: true } })
          postNumber = (_max.postNumber ?? 0) + 1
        }

        const message = await prisma.message.create({
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
    }
  })

  socket.on('close', async () => {
    if (userId) {
      connectedUsers.delete(userId)
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
      }
    }
    for (const channelId of joinedChannels) {
      rooms.get(channelId)?.delete(socket)
      if (userId) {
        broadcast(channelId, { type: 'presence:leave', payload: { userId, channelId } })
      }
    }
  })
}
