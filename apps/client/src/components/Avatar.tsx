import { resolveAttachmentUrl } from '../lib/api.ts'
import styles from './Avatar.module.css'

interface Props {
  displayName: string
  userId: string
  avatarUrl?: string | null
  size?: number
}

// Warm palette — deterministic per user, fits the terminal aesthetic
const PALETTE = [
  '#7a5a28', // amber brown
  '#28607a', // slate teal
  '#5a7828', // olive
  '#7a2858', // mauve
  '#28587a', // steel blue
  '#587828', // moss
  '#7a4228', // burnt sienna
  '#482878', // muted violet
]

function hashUserId(userId: string): number {
  let h = 0
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) >>> 0
  }
  return h
}

export default function Avatar({ displayName, userId, avatarUrl, size = 38 }: Props) {
  const initial = (displayName[0] ?? '?').toUpperCase()

  if (avatarUrl) {
    return (
      <img
        className={styles.avatar}
        src={resolveAttachmentUrl(avatarUrl)}
        alt={displayName}
        style={{ width: size, height: size }}
        draggable={false}
      />
    )
  }

  const bg = PALETTE[hashUserId(userId) % PALETTE.length]
  return (
    <div
      className={styles.initials}
      style={{ width: size, height: size, background: bg, fontSize: Math.round(size * 0.46) }}
      aria-label={displayName}
    >
      {initial}
    </div>
  )
}
