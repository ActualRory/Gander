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

function broadcast(channelId: string, event: ServerEvent, exclude?: WebSocket) {
  const room = rooms.get(channelId)
  if (!room) return
  const data = JSON.stringify(event)
  for (const socket of room) {
    if (socket !== exclude && socket.readyState === socket.OPEN) {
      socket.send(data)
    }
  }
}

function broadcastAll(event: ServerEvent, exclude?: WebSocket) {
  const data = JSON.stringify(event)
  for (const socket of connectedUsers.values()) {
    if (socket !== exclude && socket.readyState === socket.OPEN) {
      socket.send(data)
    }
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
        socket.send(JSON.stringify({
          type: 'voice:init',
          payload: { voiceRooms: voiceRoomsSnapshot },
        }))
        // Notify all other clients this user came online
        broadcastAll({ type: 'user:online', payload: { userId } }, socket)
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
          broadcastAll({ type: 'voice:leave', payload: { userId, channelId: prevChannelId } })
        }
        if (!voiceRooms.has(channelId)) voiceRooms.set(channelId, new Set())
        voiceRooms.get(channelId)!.add(userId)
        userVoiceChannel.set(userId, channelId)
        broadcastAll({ type: 'voice:join', payload: { userId, channelId } })
        break
      }

      case 'voice:leave': {
        const { channelId } = event.payload
        voiceRooms.get(channelId)?.delete(userId)
        userVoiceChannel.delete(userId)
        broadcastAll({ type: 'voice:leave', payload: { userId, channelId } })
        break
      }

      case 'message:send': {
        const { channelId, content } = event.payload
        const author = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } })
        if (!author) return

        const message = await prisma.message.create({
          data: { content, channelId, authorId: userId },
        })

        broadcast(channelId, {
          type: 'message:new',
          payload: {
            id: message.id,
            channelId,
            authorId: userId,
            authorName: author.displayName,
            content: message.content,
            createdAt: message.createdAt.toISOString(),
            editedAt: null,
          },
        })
        break
      }
    }
  })

  socket.on('close', () => {
    if (userId) {
      connectedUsers.delete(userId)
      broadcastAll({ type: 'user:offline', payload: { userId } })
      // Auto-leave voice channel on disconnect
      const voiceChannelId = userVoiceChannel.get(userId)
      if (voiceChannelId) {
        voiceRooms.get(voiceChannelId)?.delete(userId)
        userVoiceChannel.delete(userId)
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
