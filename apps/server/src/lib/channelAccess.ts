import type { Channel, ChannelMember } from '@prisma/client'
import { prisma } from './prisma.js'
import { rankOf, type UserRole } from './auth.js'

export type ChannelAccessDenied = { ok: false; status: 403 | 404 | 410; error: string }
export type ChannelAccessOk = {
  ok: true
  channel: Channel
  membership: ChannelMember | null
  isMod: boolean
  isManager: boolean
}
export type ChannelAccess = ChannelAccessOk | ChannelAccessDenied

async function loadAccess(userId: string, channelId: string): Promise<ChannelAccessOk | null> {
  const [channel, actor, membership] = await Promise.all([
    prisma.channel.findUnique({ where: { id: channelId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    prisma.channelMember.findUnique({ where: { userId_channelId: { userId, channelId } } }),
  ])
  if (!channel) return null
  const isMod = rankOf((actor?.role as UserRole) ?? 'MEMBER') >= rankOf('MODERATOR')
  return { ok: true, channel, membership, isMod, isManager: membership?.role === 'MANAGER' }
}

// Read access: members and global mods always; non-members may read open-join
// channels (PUBLIC/DEFAULT — content is effectively public). SEMI_PUBLIC is
// join-gated so its content is too. PRIVATE returns 404 to non-members so the
// channel's existence doesn't leak.
export async function canReadChannel(userId: string, channelId: string): Promise<ChannelAccess> {
  const access = await loadAccess(userId, channelId)
  if (!access) return { ok: false, status: 404, error: 'Not found' }
  if (access.membership || access.isMod) return access
  const { visibility } = access.channel
  if (visibility === 'PUBLIC' || visibility === 'DEFAULT') return access
  if (visibility === 'SEMI_PUBLIC') return { ok: false, status: 403, error: 'Join required' }
  return { ok: false, status: 404, error: 'Not found' }
}

// Write access (send/react/pin/voice): members or global mods only, never in
// archived channels.
export async function canPostInChannel(userId: string, channelId: string): Promise<ChannelAccess> {
  const access = await loadAccess(userId, channelId)
  if (!access) return { ok: false, status: 404, error: 'Not found' }
  if (!access.membership && !access.isMod) {
    return access.channel.visibility === 'PRIVATE'
      ? { ok: false, status: 404, error: 'Not found' }
      : { ok: false, status: 403, error: 'You must join this channel first' }
  }
  if (access.channel.isArchived) return { ok: false, status: 410, error: 'Channel is archived' }
  return access
}

// Manage access (rename/topic/archive/kick): channel creator, channel
// MANAGER, or global mods.
export async function canManageChannel(userId: string, channelId: string): Promise<ChannelAccess> {
  const access = await loadAccess(userId, channelId)
  if (!access) return { ok: false, status: 404, error: 'Not found' }
  if (access.isMod || access.isManager || access.channel.creatorId === userId) return access
  // Hide private channels from non-members even on manage attempts
  if (!access.membership && access.channel.visibility === 'PRIVATE') {
    return { ok: false, status: 404, error: 'Not found' }
  }
  return { ok: false, status: 403, error: 'You do not have permission to manage this channel' }
}
