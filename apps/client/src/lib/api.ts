import type { Channel, ChannelIndexEntry, ChannelIndexRequest, ChannelJoinRequest, Message, AuthResponse, User, UserRole, UserStats, AttachmentInfo, OgData, PinnedMessageEntry, SearchResult, AuditLogEntry, BanRecord } from '@gander/shared'
import { getServerUrl } from './config.ts'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const base = getServerUrl() ?? import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
  const hasBody = options?.body !== undefined
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...options?.headers,
      },
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw new Error('Connection timed out')
    throw err
  } finally {
    clearTimeout(timeout)
  }
  if (res.status === 204) return undefined as T
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
  return body as T
}

function authed(token: string): RequestInit {
  return { headers: { Authorization: `Bearer ${token}` } }
}

export const api = {
  login: (username: string, password: string) =>
    request<AuthResponse>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),

  register: (username: string, displayName: string, password: string) =>
    request<AuthResponse>('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, displayName, password }) }),

  getChannels: (token: string) =>
    request<Channel[]>('/api/channels', authed(token)),

  createChannel: (token: string, name: string, type: 'TEXT' | 'VOICE') =>
    request<Channel>('/api/channels', { method: 'POST', body: JSON.stringify({ name, type }), ...authed(token) }),

  renameChannel: (token: string, channelId: string, name: string) =>
    request<Channel>(`/api/channels/${channelId}`, { method: 'PATCH', body: JSON.stringify({ name }), ...authed(token) }),

  setChannelTopic: (token: string, channelId: string, topic: string) =>
    request<Channel>(`/api/channels/${channelId}`, { method: 'PATCH', body: JSON.stringify({ topic }), ...authed(token) }),

  deleteChannel: (token: string, channelId: string) =>
    request<void>(`/api/channels/${channelId}`, { method: 'DELETE', ...authed(token) }),

  getMessages: (token: string, channelId: string, params?: { before?: string; after?: string }) => {
    const qs = new URLSearchParams()
    if (params?.before) qs.set('before', params.before)
    if (params?.after) qs.set('after', params.after)
    const query = qs.toString() ? `?${qs}` : ''
    return request<Message[]>(`/api/messages/${channelId}${query}`, authed(token))
  },

  getUnreadCounts: (token: string, channelLastReadAt: Record<string, string>) =>
    request<{ channelId: string; count: number; mentionCount: number }[]>('/api/messages/unread', {
      method: 'POST',
      body: JSON.stringify({ channelLastReadAt }),
      ...authed(token),
    }),

  getChannelReadState: (token: string) =>
    request<{ channelId: string; lastReadAt: string }[]>('/api/channels/read', authed(token)),

  markChannelsRead: (token: string, reads: Array<{ channelId: string; lastReadAt: string }>) =>
    request<void>('/api/channels/read', {
      method: 'POST',
      body: JSON.stringify({ reads }),
      ...authed(token),
    }),

  getVoiceToken: (token: string, channelId: string) =>
    request<{ token: string; url: string }>(
      `/api/voice/${channelId}/token`,
      authed(token)
    ),

  getUsers: (token: string) =>
    request<User[]>('/api/users', authed(token)),

  updateSubtitle: (token: string, subtitle: string | null) =>
    request<User>('/api/users/me', { method: 'PATCH', body: JSON.stringify({ subtitle }), ...authed(token) }),

  getUserStats: (token: string, userId: string) =>
    request<UserStats>(`/api/users/${userId}/stats`, authed(token)),

  getDMs: (token: string) =>
    request<Channel[]>('/api/dm', authed(token)),

  startDM: (token: string, targetUserId: string) =>
    request<Channel>('/api/dm', { method: 'POST', body: JSON.stringify({ targetUserId }), ...authed(token) }),

  addReaction: (token: string, messageId: string, reaction: string) =>
    request<void>(`/api/reactions/${messageId}`, { method: 'POST', body: JSON.stringify({ reaction }), ...authed(token) }),

  removeReaction: (token: string, messageId: string, reaction: string) =>
    request<void>(`/api/reactions/${messageId}?reaction=${encodeURIComponent(reaction)}`, { method: 'DELETE', ...authed(token) }),

  editMessage: (token: string, messageId: string, content: string) =>
    request<Message>(`/api/messages/${messageId}`, { method: 'PATCH', body: JSON.stringify({ content }), ...authed(token) }),

  deleteMessage: (token: string, messageId: string) =>
    request<void>(`/api/messages/${messageId}`, { method: 'DELETE', ...authed(token) }),

  getPins: (token: string, channelId: string) =>
    request<PinnedMessageEntry[]>(`/api/channels/${channelId}/pins`, authed(token)),

  pinMessage: (token: string, channelId: string, messageId: string) =>
    request<void>(`/api/channels/${channelId}/pins/${messageId}`, { method: 'POST', ...authed(token) }),

  unpinMessage: (token: string, channelId: string, messageId: string) =>
    request<void>(`/api/channels/${channelId}/pins/${messageId}`, { method: 'DELETE', ...authed(token) }),

  getMessageByPostNumber: async (token: string, postNumber: number) => {
    try {
      return await request<{ id: string; channelId: string; createdAt: string }>(
        `/api/messages/by-post/${postNumber}`, authed(token)
      )
    } catch { return null }
  },

  searchMessages: (token: string, q: string, from?: string) =>
    request<SearchResult[]>(
      `/api/search?q=${encodeURIComponent(q)}${from ? `&from=${encodeURIComponent(from)}` : ''}`,
      authed(token)
    ),

  getOg: (token: string, url: string) =>
    request<OgData | null>(`/api/og?url=${encodeURIComponent(url)}`, authed(token)),

  uploadAvatar: async (token: string, file: File): Promise<User> => {
    const base = getServerUrl() ?? import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${base}/api/users/me/avatar`, {
      method: 'POST',
      body: form,
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body?.error ?? `HTTP ${res.status}`)
    }
    return res.json() as Promise<User>
  },

  deleteAvatar: (token: string) =>
    request<void>('/api/users/me/avatar', { method: 'DELETE', ...authed(token) }),

  // Library
  getLibraryShelves: (token: string) =>
    request<{ id: string; name: string; description: string | null; createdAt: string; creatorId: string; _count: { books: number } }[]>(
      '/api/library/shelves', authed(token)
    ),

  createLibraryShelf: (token: string, name: string) =>
    request<{ id: string; name: string; description: string | null; createdAt: string; creatorId: string; _count: { books: number } }>(
      '/api/library/shelves', { method: 'POST', body: JSON.stringify({ name }), ...authed(token) }
    ),

  updateLibraryShelf: (token: string, shelfId: string, data: { name?: string; description?: string | null }) =>
    request<unknown>(`/api/library/shelves/${shelfId}`, { method: 'PATCH', body: JSON.stringify(data), ...authed(token) }),

  deleteLibraryShelf: (token: string, shelfId: string) =>
    request<void>(`/api/library/shelves/${shelfId}`, { method: 'DELETE', ...authed(token) }),

  getLibraryBooks: (token: string, shelfId: string) =>
    request<{ id: string; title: string; author: string | null; series: string | null; genre: string | null; filename: string; storedName: string; mimeType: string; size: number; coverUrl: string | null; uploadedAt: string; uploaderId: string; uploader: { displayName: string } }[]>(
      `/api/library/shelves/${shelfId}/books`, authed(token)
    ),

  deleteLibraryBook: (token: string, shelfId: string, bookId: string) =>
    request<void>(`/api/library/shelves/${shelfId}/books/${bookId}`, { method: 'DELETE', ...authed(token) }),

  moveLibraryBook: (token: string, shelfId: string, bookId: string, targetShelfId: string) =>
    request<unknown>(`/api/library/shelves/${shelfId}/books/${bookId}`, { method: 'PATCH', body: JSON.stringify({ shelfId: targetShelfId }), ...authed(token) }),

  updateLibraryBook: (token: string, shelfId: string, bookId: string, data: { title?: string; author?: string; series?: string; genre?: string; coverUrl?: string | null }) =>
    request<unknown>(`/api/library/shelves/${shelfId}/books/${bookId}`, { method: 'PATCH', body: JSON.stringify(data), ...authed(token) }),

  updateLibraryBookCover: async (token: string, shelfId: string, bookId: string, cover: File) => {
    const base = getServerUrl() ?? import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
    const form = new FormData()
    form.append('cover', cover)
    const res = await fetch(`${base}/api/library/shelves/${shelfId}/books/${bookId}/cover`, {
      method: 'PATCH',
      body: form,
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body?.error ?? `HTTP ${res.status}`)
    }
    return res.json()
  },

  getLibraryShelfPreview: (token: string, shelfId: string) =>
    request<{ id: string; name: string; description: string | null; bookCount: number; totalSize: number }>(
      `/api/library/shelves/${shelfId}/preview`, authed(token)
    ),

  getLibraryBookPreview: (token: string, bookId: string) =>
    request<{ id: string; title: string; author: string | null; series: string | null; genre: string | null; coverUrl: string | null; mimeType: string; size: number; shelf: { id: string; name: string } | null; avgRating: number | null; reviewCount: number }>(
      `/api/library/books/${bookId}`, authed(token)
    ),

  getBookReviews: (token: string, bookId: string) =>
    request<{ reviews: { id: string; rating: number; comment: string | null; createdAt: string; reviewerId: string; reviewer: { displayName: string } }[]; avgRating: number | null; reviewCount: number }>(
      `/api/library/books/${bookId}/reviews`, authed(token)
    ),

  submitBookReview: (token: string, bookId: string, rating: number, comment: string) =>
    request<{ id: string; rating: number; comment: string | null; createdAt: string; reviewerId: string; reviewer: { displayName: string } }>(
      `/api/library/books/${bookId}/reviews`, { method: 'POST', body: JSON.stringify({ rating, comment: comment || undefined }), ...authed(token) }
    ),

  getChannelPreview: (token: string, channelId: string) =>
    request<{ id: string; name: string; type: string; topic: string | null; messageCount: number }>(
      `/api/channels/${channelId}/preview`, authed(token)
    ),

  searchLibraryBooks: (token: string, params?: { q?: string; genre?: string }) => {
    const qs = new URLSearchParams()
    if (params?.q) qs.set('q', params.q)
    if (params?.genre) qs.set('genre', params.genre)
    const query = qs.toString() ? `?${qs}` : ''
    return request<unknown[]>(`/api/library/books/search${query}`, authed(token))
  },

  uploadLibraryBook: async (token: string, shelfId: string, file: File, title: string, cover?: File | null, author?: string, series?: string, genre?: string, coverUrl?: string) => {
    const base = getServerUrl() ?? import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
    const form = new FormData()
    form.append('file', file)
    form.append('title', title || file.name)
    if (author) form.append('author', author)
    if (series) form.append('series', series)
    if (genre) form.append('genre', genre)
    if (cover) form.append('cover', cover)
    if (coverUrl) form.append('coverUrl', coverUrl)
    const res = await fetch(`${base}/api/library/shelves/${shelfId}/books`, {
      method: 'POST',
      body: form,
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body?.error ?? `HTTP ${res.status}`)
    }
    return res.json()
  },

  getBookRequests: (token: string, completed = false) =>
    request<{ id: string; title: string; author: string | null; notes: string | null; completed: boolean; requestedAt: string; requesterId: string; requester: { displayName: string } }[]>(
      `/api/library/requests?completed=${completed}`, authed(token)
    ),

  createBookRequest: (token: string, title: string, author?: string, notes?: string) =>
    request<{ id: string; title: string; author: string | null; notes: string | null; completed: boolean; requestedAt: string; requesterId: string; requester: { displayName: string } }>(
      '/api/library/requests', { method: 'POST', body: JSON.stringify({ title, author: author || undefined, notes: notes || undefined }), ...authed(token) }
    ),

  setBookRequestCompleted: (token: string, requestId: string, completed: boolean) =>
    request<{ id: string; title: string; author: string | null; notes: string | null; completed: boolean; requestedAt: string; requesterId: string; requester: { displayName: string } }>(
      `/api/library/requests/${requestId}`, { method: 'PATCH', body: JSON.stringify({ completed }), ...authed(token) }
    ),

  // File Manager
  getFileManagerStats: (token: string) =>
    request<{ totalSize: number; fileCount: number; byChannel: { channelId: string; channelName: string; fileCount: number; totalSize: number }[]; limitBytes: number | null }>(
      '/api/file-manager/stats', authed(token)
    ),

  getFileManagerFiles: (token: string, params?: { sort?: string; limit?: number; cursor?: string }) => {
    const qs = new URLSearchParams()
    if (params?.sort) qs.set('sort', params.sort)
    if (params?.limit) qs.set('limit', String(params.limit))
    if (params?.cursor) qs.set('cursor', params.cursor)
    const query = qs.toString() ? `?${qs}` : ''
    return request<{
      files: { id: string; filename: string; mimeType: string; size: number; uploadedAt: string; storedName: string; uploader: { displayName: string }; message: { channel: { id: string; name: string; type: string } } | null }[]
      nextCursor: string | null
    }>(`/api/file-manager/files${query}`, authed(token))
  },

  // Gandle
  gandleToday: (token: string) =>
    request<{ date: string; played: boolean; result: { guesses: string[]; solved: boolean } | null }>(
      '/api/gandle/today', authed(token)
    ),

  gandleSubmit: (token: string, date: string, guesses: string[], solved: boolean) =>
    request<{ date: string; guesses: string[]; solved: boolean }>(
      '/api/gandle/submit', { method: 'POST', body: JSON.stringify({ date, guesses, solved }), ...authed(token) }
    ),

  gandleResult: (token: string, date: string) =>
    request<{ date: string; played: boolean; result: { guesses: string[]; solved: boolean } | null }>(
      `/api/gandle/result?date=${encodeURIComponent(date)}`, authed(token)
    ),

  gandleLeaderboard: (token: string, date: string) =>
    request<{ userId: string; displayName: string; avatarUrl: string | null; solved: boolean; guessCount: number; guesses: string[] | null; completedAt: string }[]>(
      `/api/gandle/leaderboard?date=${encodeURIComponent(date)}`, authed(token)
    ),

  // Channel index and joining
  getChannelIndex: (token: string) =>
    request<ChannelIndexEntry[]>('/api/channels/index', authed(token)),

  joinChannel: (token: string, channelId: string, message?: string) =>
    request<{ status?: 'pending' } | void>(`/api/channels/${channelId}/join`, {
      method: 'POST',
      ...(message !== undefined ? { body: JSON.stringify({ message }) } : {}),
      ...authed(token),
    }),

  submitIndexRequest: (token: string, channelId: string, visibility: 'PUBLIC' | 'SEMI_PUBLIC') =>
    request<void>(`/api/channels/${channelId}/index-request`, {
      method: 'POST', body: JSON.stringify({ visibility }), ...authed(token),
    }),

  approveJoinRequest: (token: string, channelId: string, requestId: string) =>
    request<void>(`/api/channels/${channelId}/join-requests/${requestId}/approve`, { method: 'POST', ...authed(token) }),

  rejectJoinRequest: (token: string, channelId: string, requestId: string) =>
    request<void>(`/api/channels/${channelId}/join-requests/${requestId}/reject`, { method: 'POST', ...authed(token) }),

  archiveChannel: (token: string, channelId: string, isArchived: boolean) =>
    request<void>(`/api/channels/${channelId}`, { method: 'PATCH', body: JSON.stringify({ isArchived }), ...authed(token) }),

  leaveChannel: (token: string, channelId: string) =>
    request<void>(`/api/channels/${channelId}/membership`, { method: 'DELETE', ...authed(token) }),

  // Admin — users
  adminGetUsers: (token: string) =>
    request<(User & { messageCount: number })[]>('/api/admin/users', authed(token)),

  adminGetUserBans: (token: string, userId: string) =>
    request<BanRecord[]>(`/api/admin/users/${userId}/bans`, authed(token)),

  adminSetRole: (token: string, userId: string, role: UserRole) =>
    request<void>(`/api/admin/users/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role }), ...authed(token) }),

  adminTimeout: (token: string, userId: string, duration: number, reason?: string) =>
    request<void>(`/api/admin/users/${userId}/timeout`, { method: 'POST', body: JSON.stringify({ duration, reason }), ...authed(token) }),

  adminClearTimeout: (token: string, userId: string) =>
    request<void>(`/api/admin/users/${userId}/timeout`, { method: 'DELETE', ...authed(token) }),

  adminBanUser: (token: string, userId: string, reason?: string) =>
    request<void>(`/api/admin/users/${userId}/ban`, { method: 'POST', body: JSON.stringify({ reason }), ...authed(token) }),

  adminUnbanUser: (token: string, userId: string) =>
    request<void>(`/api/admin/users/${userId}/unban`, { method: 'POST', ...authed(token) }),

  adminSetDisplayName: (token: string, userId: string, displayName: string) =>
    request<void>(`/api/admin/users/${userId}/displayName`, { method: 'PATCH', body: JSON.stringify({ displayName }), ...authed(token) }),

  // Admin — channels
  adminGetChannels: (token: string) =>
    request<(Channel & { memberCount: number; messageCount: number })[]>('/api/admin/channels', authed(token)),

  adminGetIndexRequests: (token: string) =>
    request<ChannelIndexRequest[]>('/api/admin/channels/index-requests', authed(token)),

  adminApproveIndex: (token: string, requestId: string, visibility?: string) =>
    request<void>(`/api/admin/channels/index-requests/${requestId}/approve`, { method: 'POST', body: JSON.stringify({ visibility }), ...authed(token) }),

  adminRejectIndex: (token: string, requestId: string) =>
    request<void>(`/api/admin/channels/index-requests/${requestId}/reject`, { method: 'POST', ...authed(token) }),

  adminUpdateChannel: (token: string, channelId: string, data: { name?: string; topic?: string; isArchived?: boolean; visibility?: string }) =>
    request<void>(`/api/admin/channels/${channelId}`, { method: 'PATCH', body: JSON.stringify(data), ...authed(token) }),

  adminDeleteChannel: (token: string, channelId: string) =>
    request<void>(`/api/admin/channels/${channelId}`, { method: 'DELETE', ...authed(token) }),

  // Admin — messages
  adminDeleteMessage: (token: string, messageId: string) =>
    request<void>(`/api/admin/messages/${messageId}`, { method: 'DELETE', ...authed(token) }),

  // Admin — join requests
  adminGetJoinRequests: (token: string) =>
    request<ChannelJoinRequest[]>('/api/admin/join-requests', authed(token)),

  adminApproveJoinRequest: (token: string, requestId: string) =>
    request<void>(`/api/admin/join-requests/${requestId}/approve`, { method: 'POST', ...authed(token) }),

  adminRejectJoinRequest: (token: string, requestId: string) =>
    request<void>(`/api/admin/join-requests/${requestId}/reject`, { method: 'POST', ...authed(token) }),

  // Admin — audit log
  adminGetAuditLog: (token: string, params?: { action?: string; actorId?: string; targetId?: string; before?: string; limit?: number }) => {
    const qs = new URLSearchParams()
    if (params?.action) qs.set('action', params.action)
    if (params?.actorId) qs.set('actorId', params.actorId)
    if (params?.targetId) qs.set('targetId', params.targetId)
    if (params?.before) qs.set('before', params.before)
    if (params?.limit) qs.set('limit', String(params.limit))
    const query = qs.toString() ? `?${qs}` : ''
    return request<AuditLogEntry[]>(`/api/admin/audit${query}`, authed(token))
  },

  // Admin — stats
  adminGetStats: (token: string) =>
    request<{ userCount: number; messageCount: number; channelCount: number; totalAttachmentBytes: number }>('/api/admin/stats', authed(token)),

  // Admin — files
  adminGetFiles: (token: string, params?: { sort?: string; limit?: number; cursor?: string }) => {
    const qs = new URLSearchParams()
    if (params?.sort) qs.set('sort', params.sort)
    if (params?.limit) qs.set('limit', String(params.limit))
    if (params?.cursor) qs.set('cursor', params.cursor)
    const query = qs.toString() ? `?${qs}` : ''
    return request<{
      files: { id: string; filename: string; mimeType: string; size: number; uploadedAt: string; uploaderName: string; url: string; channel: { id: string; name: string; type: string } | null }[]
      nextCursor: string | null
    }>(`/api/admin/files${query}`, authed(token))
  },

  adminGetFileStats: (token: string) =>
    request<{ totalSize: number; fileCount: number; limitBytes: number | null }>('/api/admin/file-stats', authed(token)),

  uploadAttachments: async (token: string, files: File[]): Promise<AttachmentInfo[]> => {
    const base = getServerUrl() ?? import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
    const form = new FormData()
    for (const file of files.slice(0, 5)) {
      form.append('file', file)
    }
    const res = await fetch(`${base}/api/attachments`, {
      method: 'POST',
      body: form,
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body?.error ?? `HTTP ${res.status}`)
    }
    const body = await res.json() as { attachments: AttachmentInfo[] }
    return body.attachments
  },
}

export function resolveAttachmentUrl(relativePath: string): string {
  const base = getServerUrl() ?? import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
  return `${base}${relativePath}`
}
