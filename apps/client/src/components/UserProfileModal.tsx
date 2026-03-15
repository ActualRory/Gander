import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { User, UserStats } from '@gander/shared'
import { api } from '../lib/api.ts'
import Avatar from './Avatar.tsx'
import AvatarCropModal from './AvatarCropModal.tsx'
import styles from './UserProfileModal.module.css'

interface Props {
  user: User
  isOnline: boolean
  isOwnProfile: boolean
  token: string
  onSubtitleUpdate: (updated: User) => void
  onClose: () => void
  onAvatarUpdate?: (updated: User) => void
}

export default function UserProfileModal({
  user,
  isOnline,
  isOwnProfile,
  token,
  onSubtitleUpdate,
  onClose,
  onAvatarUpdate,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [editingSubtitle, setEditingSubtitle] = useState(false)
  const [subtitleDraft, setSubtitleDraft] = useState(user.subtitle ?? '')
  const [stats, setStats] = useState<UserStats | null>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [cropFile, setCropFile] = useState<File | null>(null)

  useEffect(() => {
    api.getUserStats(token, user.id).then(setStats).catch(() => {})
  }, [token, user.id])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (cropFile) { setCropFile(null); return }
        onClose()
      }
    }
    function onMouseDown(e: MouseEvent) {
      if (cropFile) return
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onMouseDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onMouseDown)
    }
  }, [onClose, cropFile])

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

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCropFile(file)
    e.target.value = ''
  }

  async function handleCropConfirm(blob: Blob) {
    setCropFile(null)
    setAvatarUploading(true)
    try {
      const updated = await api.uploadAvatar(token, new File([blob], 'avatar.png', { type: 'image/png' }))
      onAvatarUpdate?.(updated)
    } finally {
      setAvatarUploading(false)
    }
  }

  async function handleRemoveAvatar() {
    setAvatarUploading(true)
    try {
      await api.deleteAvatar(token)
      onAvatarUpdate?.({ ...user, avatarUrl: null })
    } finally {
      setAvatarUploading(false)
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

  const profileModal = createPortal(
    <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} className={styles.modal}>
        <div className={`${styles.status} ${isOnline ? styles.online : styles.offline}`}>
          {statusText}
        </div>

        <div className={styles.body}>
          <div className={styles.avatarSection}>
            {isOwnProfile ? (
              <>
                <button
                  type="button"
                  className={styles.avatarBtn}
                  onClick={() => avatarInputRef.current?.click()}
                  onContextMenu={e => { e.preventDefault(); if (user.avatarUrl && !avatarUploading) handleRemoveAvatar() }}
                  title={avatarUploading ? 'uploading…' : user.avatarUrl ? 'click to change · right-click to remove' : 'click to set profile picture'}
                  disabled={avatarUploading}
                >
                  <Avatar displayName={user.displayName} userId={user.id} avatarUrl={user.avatarUrl} size={64} />
                  <span className={styles.avatarOverlay}>{avatarUploading ? '…' : 'change'}</span>
                </button>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className={styles.avatarInput}
                  onChange={handleAvatarChange}
                />
              </>
            ) : (
              <Avatar displayName={user.displayName} userId={user.id} avatarUrl={user.avatarUrl} size={64} />
            )}
          </div>
          <div className={styles.displayName}>{user.displayName}</div>
          <div className={styles.username}>@{user.username}</div>

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

        {stats && (
          <div className={styles.stats}>
            <div className={styles.stat}>
              <span className={styles.statValue}>{stats.messageCount.toLocaleString()}</span>
              <span className={styles.statLabel}>messages sent</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{formatVoiceTime(stats.voiceSeconds)}</span>
              <span className={styles.statLabel}>in voice</span>
            </div>
          </div>
        )}

        <div className={styles.footer}>
          <span>member since {formatDate(user.createdAt)}</span>
          <button type="button" className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
      </div>
    </div>,
    document.body
  )

  return <>
    {profileModal}
    {cropFile != null && (
      <AvatarCropModal
        file={cropFile}
        onConfirm={handleCropConfirm}
        onCancel={() => setCropFile(null)}
      />
    )}
  </>
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

function formatVoiceTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}
