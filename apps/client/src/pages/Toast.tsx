import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import styles from './Toast.module.css'

interface ToastItem {
  id: string
  authorName: string
  channelName: string
  content: string
}

export default function ToastPage() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Listen for toast events from the main window
  useEffect(() => {
    const unlistenPromise = listen<{ authorName: string; channelName: string; content: string }>(
      'toast:new',
      event => {
        const item: ToastItem = {
          id: Date.now().toString(),
          ...event.payload,
        }
        setToasts(prev => {
          // Max 3; drop the oldest if over limit
          const next = prev.length >= 3 ? prev.slice(1) : prev
          return [...next, item]
        })
        // Schedule auto-dismiss
        const timer = setTimeout(() => {
          dismiss(item.id)
        }, 5000)
        timersRef.current.set(item.id, timer)
      }
    )
    return () => {
      unlistenPromise.then(f => f())
    }
  }, [])

  // On mount, make the window pass-through so it never blocks the desktop while empty.
  // We keep the window visible at all times (hidden windows get JS throttled on Windows/WebView2).
  useEffect(() => {
    getCurrentWindow().setIgnoreCursorEvents(true).catch(() => {})
  }, [])

  // Toggle cursor pass-through based on whether there are active toasts.
  useEffect(() => {
    getCurrentWindow().setIgnoreCursorEvents(toasts.length === 0).catch(() => {})
  }, [toasts.length])

  function dismiss(id: string) {
    const timer = timersRef.current.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  async function handleClick() {
    const mainWin = await WebviewWindow.getByLabel('main')
    if (mainWin) {
      await mainWin.unminimize().catch(() => {})
      await mainWin.setFocus().catch(() => {})
    }
  }

  return (
    <div className={styles.container}>
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={styles.toast}
          onClick={handleClick}
          onAuxClick={e => { if (e.button === 1) dismiss(toast.id) }}
        >
          <div className={styles.header}>
            <span className={styles.channel}>{toast.channelName}</span>
            <span className={styles.dot}>·</span>
            <span className={styles.author}>{toast.authorName}</span>
            <button
              className={styles.close}
              onClick={e => { e.stopPropagation(); dismiss(toast.id) }}
              aria-label="dismiss"
            >✕</button>
          </div>
          <div className={styles.content}>{toast.content}</div>
        </div>
      ))}
    </div>
  )
}
