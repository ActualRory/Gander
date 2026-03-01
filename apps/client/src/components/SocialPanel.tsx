import { useState } from 'react'
import type { User } from '@gander/shared'
import styles from './SocialPanel.module.css'

interface Props {
  users: User[]
  onlineUserIds: Set<string>
  voiceParticipants: Record<string, string[]>
  onUserClick: (userId: string, x: number, y: number) => void
  onUserRightClick: (userId: string, x: number, y: number) => void
}

function getStatus(userId: string, onlineUserIds: Set<string>, voiceParticipants: Record<string, string[]>): string {
  const inVoice = Object.values(voiceParticipants).some(ids => ids.includes(userId))
  if (inVoice) return 'Chatting'
  if (onlineUserIds.has(userId)) return 'Online'
  return 'Offline'
}

export default function SocialPanel({ users, onlineUserIds, voiceParticipants, onUserClick, onUserRightClick }: Props) {
  const [panelOpen, setPanelOpen] = useState(true)
  const [onlineOpen, setOnlineOpen] = useState(true)
  const [offlineOpen, setOfflineOpen] = useState(true)

  const online = users.filter(u => onlineUserIds.has(u.id))
  const offline = users.filter(u => !onlineUserIds.has(u.id))

  if (!panelOpen) {
    return (
      <div className={styles.collapsed}>
        <div className={styles.collapsedHeader}>
          <button
            type="button"
            className={styles.expandBtn}
            onClick={() => setPanelOpen(true)}
            title="Show members"
          >
            «
          </button>
        </div>
      </div>
    )
  }

  function renderUser(u: User, isOffline: boolean) {
    const status = getStatus(u.id, onlineUserIds, voiceParticipants)
    return (
      <li
        key={u.id}
        className={`${styles.user} ${isOffline ? styles.offline : ''}`}
        onClick={e => onUserClick(u.id, e.clientX, e.clientY)}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onUserRightClick(u.id, e.clientX, e.clientY) }}
      >
        <span className={styles.dot}>·</span>
        <span className={styles.userInfo}>
          <span className={styles.userName}>{u.displayName}</span>
          <span className={styles.status}>{status}</span>
        </span>
      </li>
    )
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>members</span>
        <button
          type="button"
          className={styles.collapseBtn}
          onClick={() => setPanelOpen(false)}
          title="Hide members"
        >
          »
        </button>
      </div>

      <div className={styles.body}>
        <div className={styles.section}>
          <button
            type="button"
            className={styles.sectionHeader}
            onClick={() => setOnlineOpen(o => !o)}
          >
            <span className={styles.chevron}>{onlineOpen ? '▼' : '▶'}</span>
            online — {online.length}
          </button>
          {onlineOpen && (
            <ul className={styles.userList}>
              {online.map(u => renderUser(u, false))}
              {online.length === 0 && (
                <li className={styles.empty}>none</li>
              )}
            </ul>
          )}
        </div>

        <div className={styles.section}>
          <button
            type="button"
            className={styles.sectionHeader}
            onClick={() => setOfflineOpen(o => !o)}
          >
            <span className={styles.chevron}>{offlineOpen ? '▼' : '▶'}</span>
            offline — {offline.length}
          </button>
          {offlineOpen && (
            <ul className={styles.userList}>
              {offline.map(u => renderUser(u, true))}
              {offline.length === 0 && (
                <li className={`${styles.empty} ${styles.offline}`}>none</li>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
