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
  isSystem: boolean
  /** Client-generated correlation ID echoed back by the server to resolve optimistic messages */
  tempId?: string
}

export interface PinnedMessageEntry {
  id: string
  messageId: string
  channelId: string
  pinnedAt: string
  pinnedBy: string
  message: {
    id: string
    channelId: string
    authorId: string
    authorName: string
    content: string
    createdAt: string
    postNumber: number | null
    attachments: AttachmentInfo[]
  }
}

export interface SearchResult {
  id: string
  channelId: string
  channelName: string
  channelType: string
  authorName: string
  content: string
  createdAt: string
  postNumber: number | null
}
