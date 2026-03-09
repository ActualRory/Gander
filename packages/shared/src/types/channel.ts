export type ChannelType = 'TEXT' | 'VOICE' | 'DM' | 'GROUP'

export interface Channel {
  id: string
  name: string
  type: ChannelType
  topic?: string | null
  createdAt: string
  creatorId: string | null
  otherUserId?: string
}
