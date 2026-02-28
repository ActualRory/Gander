import type { Channel, Message, AuthResponse, User } from '@gander/shared'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const hasBody = options?.body !== undefined
  const res = await fetch(`${BASE}${path}`, {
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

  getVoiceToken: (token: string, channelId: string) =>
    request<{ token: string; url: string }>(
      `/api/voice/${channelId}/token`,
      authed(token)
    ),

  getUsers: (token: string) =>
    request<User[]>('/api/users', authed(token)),
}
