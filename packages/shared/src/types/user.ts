export interface User {
  id: string
  username: string
  displayName: string
  createdAt: string
}

export interface AuthResponse {
  token: string
  user: User
}
