export interface Notification {
  id: string
  type: string
  title: string
  body: string | null
  meta: Record<string, unknown> | null
  read: boolean
  createdAt: string
}
