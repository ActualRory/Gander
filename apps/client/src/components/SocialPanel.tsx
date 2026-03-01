import { useState } from 'react'
import type { User } from '@gander/shared'
import styles from './SocialPanel.module.css'

interface Props {
  users: User[]
  onlineUserIds: Set<string>
  onUserRightClick: (userId: string, x: number, y: number) => void
}

export default function SocialPanel({ users, onlineUserIds, onUserRightClick }: Props) {
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
              {online.map(u => (
                <li
                  key={u.id}
                  className={styles.user}
                  onContextMenu={e => { e.preventDefault(); onUserRightClick(u.id, e.clientX, e.clientY) }}
                >
                  <span className={styles.dot}>·</span>
                  {u.displayName}
                </li>
              ))}
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
              {offline.map(u => (
                <li
                  key={u.id}
                  className={`${styles.user} ${styles.offline}`}
                  onContextMenu={e => { e.preventDefault(); onUserRightClick(u.id, e.clientX, e.clientY) }}
                >
                  <span className={styles.dot}>·</span>
                  {u.displayName}
                </li>
              ))}
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
