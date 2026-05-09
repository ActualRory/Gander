export type ChannelType = 'TEXT' | 'VOICE' | 'DM' | 'GROUP'
export type ChannelVisibility = 'PRIVATE' | 'PUBLIC' | 'SEMI_PUBLIC' | 'DEFAULT'
export type ChannelMemberRole = 'MEMBER' | 'MANAGER'
export type IndexRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED'
export type JoinRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export interface Channel {
  id: string
  name: string
  type: ChannelType
  topic?: string | null
  createdAt: string
  creatorId: string | null
  otherUserId?: string
  visibility: ChannelVisibility
  isArchived: boolean
}

export interface ChannelIndexEntry {
  id: string
  name: string
  type: ChannelType
  topic: string | null
  createdAt: string
  visibility: ChannelVisibility
  memberCount: number
  messageCount: number
  liveParticipantCount: number
  isMember: boolean
  hasPendingJoinRequest: boolean
}

export interface ChannelIndexRequest {
  id: string
  channelId: string
  channelName: string
  requestedById: string
  requestedByName: string
  requestedVisibility: ChannelVisibility
  status: IndexRequestStatus
  reviewedById: string | null
  reviewedAt: string | null
  createdAt: string
}

export interface ChannelJoinRequest {
  id: string
  userId: string
  username: string
  displayName: string
  channelId: string
  channelName: string
  message: string | null
  status: JoinRequestStatus
  reviewedById: string | null
  reviewedAt: string | null
  createdAt: string
}
