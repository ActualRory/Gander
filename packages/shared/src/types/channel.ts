export type ChannelType = 'TEXT' | 'VOICE' | 'DM' | 'GROUP'

export interface Channel {
  id: string
  name: string
  type: ChannelType
  createdAt: string
  creatorId: string | null
}
