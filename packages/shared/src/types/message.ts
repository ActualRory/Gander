export interface ReactionSummary {
  reaction: string
  count: number
  userIds: string[]
}

export interface MessageReplyPreview {
  id: string
  authorName: string
  content: string
}

export interface Message {
  id: string
  channelId: string
  authorId: string
  authorName: string
  content: string
  createdAt: string
  editedAt: string | null
  replyTo: MessageReplyPreview | null
  reactions: ReactionSummary[]
}
