export interface AuditLogEntry {
  id: string
  createdAt: string
  actorId: string | null
  actorName: string | null
  action: string
  targetId: string | null
  targetType: string | null
  meta: Record<string, unknown> | null
}
