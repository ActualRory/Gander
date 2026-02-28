export interface Message {
  id: string
  channelId: string
  authorId: string
  authorName: string
  content: string
  createdAt: string
  editedAt: string | null
}
