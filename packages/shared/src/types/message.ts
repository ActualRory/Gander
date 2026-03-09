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

export interface AttachmentInfo {
  id: string
  url: string       // server-relative path, e.g. "/uploads/abc123.jpg"
  mimeType: string
  filename: string
  size: number      // bytes
}

export interface Message {
  id: string
  channelId: string
  authorId: string
  authorName: string
  content: string
  createdAt: string
  editedAt: string | null
  postNumber: number | null
  replyTo: MessageReplyPreview | null
  reactions: ReactionSummary[]
  mentions: string[]
  attachments: AttachmentInfo[]
}
