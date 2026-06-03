import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Notification } from '@gander/shared'
import { api } from '../lib/api.ts'
import styles from './NotificationInbox.module.css'

interface Props {
  token: string
  notifications: Notification[]
  onMarkRead: (id: string) => void
  onMarkAllRead: () => void
  onNotificationClick?: (n: Notification) => void
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function NotificationInbox({ token, notifications, onMarkRead, onMarkAllRead, onNotificationClick }: Props) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const unreadCount = notifications.filter(n => !n.read).length

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function handleMarkRead(id: string) {
    await api.markNotificationRead(token, id)
    onMarkRead(id)
  }

  async function handleMarkAllRead() {
    await api.markAllNotificationsRead(token)
    onMarkAllRead()
  }

  const btn = (
    <button
      ref={btnRef}
      type="button"
      className={`${styles.bell} ${unreadCount > 0 ? styles.bellActive : ''}`}
      onClick={() => setOpen(o => !o)}
      title="notifications"
    >
      {unreadCount > 0 ? `[!${unreadCount > 9 ? '9+' : unreadCount}]` : '[○]'}
    </button>
  )

  const panel = open && createPortal(
    <div ref={panelRef} className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>notifications</span>
        {unreadCount > 0 && (
          <button type="button" className={styles.markAllBtn} onClick={handleMarkAllRead}>
            [mark all read]
          </button>
        )}
      </div>
      <div className={styles.list}>
        {notifications.length === 0 && (
          <div className={styles.empty}>no notifications</div>
        )}
        {notifications.map(n => (
          <div
            key={n.id}
            className={`${styles.item} ${n.read ? styles.itemRead : styles.itemUnread}`}
            onClick={() => {
              if (!n.read) handleMarkRead(n.id)
              onNotificationClick?.(n)
              setOpen(false)
            }}
          >
            <div className={styles.itemTitle}>{n.title}</div>
            {n.body && <div className={styles.itemBody}>{n.body}</div>}
            <div className={styles.itemTime}>{timeAgo(n.createdAt)}</div>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  )

  return (
    <>
      {btn}
      {panel}
    </>
  )
}
