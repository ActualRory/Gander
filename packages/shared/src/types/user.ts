export interface User {
  id: string
  username: string
  displayName: string
  subtitle: string | null
  createdAt: string
  lastSeenAt: string | null
}

export interface AuthResponse {
  token: string
  user: User
}

export interface UserStats {
  messageCount: number
  voiceSeconds: number
}
