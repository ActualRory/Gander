export type UserRole = 'MEMBER' | 'MODERATOR' | 'ADMIN' | 'SUPERADMIN' | 'ROOT'

export interface User {
  id: string
  username: string
  displayName: string
  subtitle: string | null
  avatarUrl: string | null
  createdAt: string
  lastSeenAt: string | null
  role: UserRole
  isBanned?: boolean
  isArchived?: boolean
  timeoutUntil?: string | null
}

export interface AuthResponse {
  token: string
  user: User
}

export interface UserStats {
  messageCount: number
  voiceSeconds: number
}

export interface BanRecord {
  id: string
  userId: string
  issuedById: string
  issuedByName: string
  reason: string | null
  bannedAt: string
  unbannedAt: string | null
  active: boolean
}
