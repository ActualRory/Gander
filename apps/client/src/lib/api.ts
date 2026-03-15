import type { Channel, Message, AuthResponse, User, UserStats, AttachmentInfo, OgData, PinnedMessageEntry, SearchResult } from '@gander/shared'
import { getServerUrl } from './config.ts'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const base = getServerUrl() ?? import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
  const hasBody = options?.body !== undefined
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...options?.headers,
    },
  })
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
    request<{ id: string; name: string; createdAt: string; creatorId: string; _count: { books: number } }[]>(
      '/api/library/shelves', authed(token)
    ),

  createLibraryShelf: (token: string, name: string) =>
    request<{ id: string; name: string; createdAt: string; creatorId: string; _count: { books: number } }>(
      '/api/library/shelves', { method: 'POST', body: JSON.stringify({ name }), ...authed(token) }
    ),

  renameLibraryShelf: (token: string, shelfId: string, name: string) =>
    request<unknown>(`/api/library/shelves/${shelfId}`, { method: 'PATCH', body: JSON.stringify({ name }), ...authed(token) }),

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

  searchLibraryBooks: (token: string, params?: { q?: string; genre?: string }) => {
    const qs = new URLSearchParams()
    if (params?.q) qs.set('q', params.q)
    if (params?.genre) qs.set('genre', params.genre)
    const query = qs.toString() ? `?${qs}` : ''
    return request<unknown[]>(`/api/library/books/search${query}`, authed(token))
  },

  uploadLibraryBook: async (token: string, shelfId: string, file: File, title: string, cover?: File | null, author?: string, series?: string, genre?: string) => {
    const base = getServerUrl() ?? import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
    const form = new FormData()
    form.append('file', file)
    form.append('title', title || file.name)
    if (author) form.append('author', author)
    if (series) form.append('series', series)
    if (genre) form.append('genre', genre)
    if (cover) form.append('cover', cover)
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

  gandleLeaderboard: (token: string, date: string) =>
    request<{ userId: string; displayName: string; avatarUrl: string | null; solved: boolean; guessCount: number; guesses: string[] | null; completedAt: string }[]>(
      `/api/gandle/leaderboard?date=${encodeURIComponent(date)}`, authed(token)
    ),

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
