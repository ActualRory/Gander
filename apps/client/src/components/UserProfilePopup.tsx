import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { User } from '@gander/shared'
import { api } from '../lib/api.ts'
import Avatar from './Avatar.tsx'
import styles from './UserProfilePopup.module.css'

interface Props {
  user: User
  x: number
  y: number
  isOnline: boolean
  isOwnProfile: boolean
  token: string
  onSubtitleUpdate: (updated: User) => void
  onClose: () => void
}

export default function UserProfilePopup({
  user,
  x,
  y,
  isOnline,
  isOwnProfile,
  token,
  onSubtitleUpdate,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [editingSubtitle, setEditingSubtitle] = useState(false)
  const [subtitleDraft, setSubtitleDraft] = useState(user.subtitle ?? '')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onMouseDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onMouseDown)
    }
  }, [onClose])

  // Clamp position to viewport
  const POPUP_W = 260
  const POPUP_H = 130
  const clampedX = Math.min(x, window.innerWidth - POPUP_W - 8)
  const clampedY = Math.min(y, window.innerHeight - POPUP_H - 8)

  async function saveSubtitle() {
    setEditingSubtitle(false)
    const trimmed = subtitleDraft.trim() || null
    if (trimmed === user.subtitle) return
    try {
      const updated = await api.updateSubtitle(token, trimmed)
      onSubtitleUpdate(updated)
    } catch {
      setSubtitleDraft(user.subtitle ?? '')
    }
  }

  function handleSubtitleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') saveSubtitle()
    if (e.key === 'Escape') {
      setEditingSubtitle(false)
      setSubtitleDraft(user.subtitle ?? '')
    }
  }

  const statusText = isOnline ? 'Currently Online' : formatLastSeen(user.lastSeenAt)

  return createPortal(
    <div
      ref={ref}
      className={styles.popup}
      style={{ top: clampedY, left: clampedX }}
    >
      <div className={`${styles.status} ${isOnline ? styles.online : styles.offline}`}>
        {statusText}
      </div>

      <div className={styles.body}>
        <div className={styles.avatarRow}>
          <Avatar displayName={user.displayName} userId={user.id} avatarUrl={user.avatarUrl} size={40} />
          <div className={styles.displayName}>{user.displayName}</div>
        </div>

        {isOwnProfile ? (
          editingSubtitle ? (
            <input
              className={styles.subtitleInput}
              value={subtitleDraft}
              autoFocus
              maxLength={80}
              onChange={e => setSubtitleDraft(e.target.value)}
              onBlur={saveSubtitle}
              onKeyDown={handleSubtitleKey}
              placeholder="set a subtitle..."
            />
          ) : (
            <button
              type="button"
              className={`${styles.subtitle} ${styles.subtitleEditable}`}
              onClick={() => setEditingSubtitle(true)}
              title="Click to edit"
            >
              {user.subtitle || <span className={styles.subtitleEmpty}>click to set subtitle</span>}
            </button>
          )
        ) : (
          user.subtitle && <div className={styles.subtitle}>{user.subtitle}</div>
        )}
      </div>

      <div className={styles.footer}>
        member since {formatDate(user.createdAt)}
      </div>
    </div>,
    document.body
  )
}

function formatLastSeen(lastSeenAt: string | null): string {
  if (!lastSeenAt) return 'last seen: unknown'
  const diff = Date.now() - new Date(lastSeenAt).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'last seen: just now'
  if (minutes < 60) return `last seen: ${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `last seen: ${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `last seen: ${days}d ago`
  return `last seen: ${new Date(lastSeenAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}
