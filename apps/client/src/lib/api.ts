import type { Channel, Message, AuthResponse, User, AttachmentInfo, OgData } from '@gander/shared'
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

  deleteChannel: (token: string, channelId: string) =>
    request<void>(`/api/channels/${channelId}`, { method: 'DELETE', ...authed(token) }),

  getMessages: (token: string, channelId: string) =>
    request<Message[]>(`/api/messages/${channelId}`, authed(token)),

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

  getOg: (token: string, url: string) =>
    request<OgData | null>(`/api/og?url=${encodeURIComponent(url)}`, authed(token)),

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
