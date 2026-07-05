import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Channel, User } from '@gander/shared'
import { useFocusTrap } from '../lib/useFocusTrap.ts'
import styles from './QuickSwitcher.module.css'

interface Props {
  channels: Channel[]
  dmChannels: Channel[]
  users: User[]
  currentUserId: string
  unreadCounts: Record<string, number>
  onSelectChannel: (channel: Channel) => void
  onSelectUser: (userId: string) => void
  onClose: () => void
}

type Entry =
  | { kind: 'channel'; channel: Channel; label: string; sub: string | null }
  | { kind: 'dm'; channel: Channel; label: string; sub: string | null }
  | { kind: 'user'; user: User; label: string; sub: string | null }

// Prefix match beats substring, substring beats subsequence; no match = drop
function scoreMatch(query: string, target: string): number {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (t.startsWith(q)) return 3
  if (t.includes(q)) return 2
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length ? 1 : 0
}

export default function QuickSwitcher({ channels, dmChannels, users, currentUserId, unreadCounts, onSelectChannel, onSelectUser, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const trapRef = useFocusTrap<HTMLDivElement>()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const entries = useMemo<Entry[]>(() => {
    const channelEntries: Entry[] = channels
      .filter(c => c.type === 'TEXT' || c.type === 'VOICE')
      .map(c => ({
        kind: 'channel' as const,
        channel: c,
        label: `${c.type === 'VOICE' ? '▸' : '#'} ${c.name}`,
        sub: c.topic ?? (c.type === 'VOICE' ? 'voice' : null),
      }))
    const dmUserIds = new Set(dmChannels.map(c => c.otherUserId))
    const dmEntries: Entry[] = dmChannels.map(c => {
      const other = users.find(u => u.id === c.otherUserId)
      return {
        kind: 'dm' as const,
        channel: c,
        label: `@ ${other?.displayName ?? c.name}`,
        sub: other ? `@${other.username}` : null,
      }
    })
    // Users without an existing DM — selecting starts one
    const userEntries: Entry[] = users
      .filter(u => u.id !== currentUserId && !u.isArchived && !dmUserIds.has(u.id))
      .map(u => ({
        kind: 'user' as const,
        user: u,
        label: `@ ${u.displayName}`,
        sub: `@${u.username}`,
      }))
    return [...channelEntries, ...dmEntries, ...userEntries]
  }, [channels, dmChannels, users, currentUserId])

  const results = useMemo(() => {
    const q = query.trim()
    if (!q) {
      // Empty query: unread channels first (Discord behavior), then channels, then DMs
      const unreadFirst = [...entries].sort((a, b) => {
        const aUnread = a.kind !== 'user' && (unreadCounts[a.channel.id] ?? 0) > 0 ? 1 : 0
        const bUnread = b.kind !== 'user' && (unreadCounts[b.channel.id] ?? 0) > 0 ? 1 : 0
        if (aUnread !== bUnread) return bUnread - aUnread
        const kindOrder = { channel: 0, dm: 1, user: 2 }
        return kindOrder[a.kind] - kindOrder[b.kind]
      })
      return unreadFirst.slice(0, 8)
    }
    return entries
      .map(e => {
        const nameScore = scoreMatch(q, e.kind === 'user' ? e.user.displayName : e.kind === 'dm' ? e.label.slice(2) : e.channel.name)
        const subScore = e.sub ? scoreMatch(q, e.sub) : 0
        return { entry: e, score: Math.max(nameScore, subScore) }
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(r => r.entry)
  }, [entries, query, unreadCounts])

  useEffect(() => setIndex(0), [query])

  function choose(entry: Entry) {
    onClose()
    if (entry.kind === 'user') onSelectUser(entry.user.id)
    else onSelectChannel(entry.channel)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[index]) choose(results[index])
    }
  }

  return createPortal(
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()} role="dialog" aria-label="quick switcher">
      <div className={styles.box} ref={trapRef}>
        <input
          ref={inputRef}
          className={styles.input}
          placeholder="jump to a channel or user…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="search channels and users"
        />
        <div className={styles.results} ref={listRef}>
          {results.length === 0 && <div className={styles.empty}>no matches</div>}
          {results.map((r, i) => {
            const key = r.kind === 'user' ? `u:${r.user.id}` : `c:${r.channel.id}`
            const unread = r.kind !== 'user' ? unreadCounts[r.channel.id] ?? 0 : 0
            return (
              <button
                key={key}
                type="button"
                className={`${styles.result}${i === index ? ` ${styles.resultActive}` : ''}`}
                onMouseEnter={() => setIndex(i)}
                onMouseDown={e => { e.preventDefault(); choose(r) }}
              >
                <span className={styles.resultLabel}>{r.label}</span>
                {r.sub && <span className={styles.resultSub}>{r.sub}</span>}
                {unread > 0 && <span className={styles.resultUnread}>[{unread}]</span>}
              </button>
            )
          })}
        </div>
        <div className={styles.hint}>[↑↓] navigate  [enter] open  [esc] close</div>
      </div>
    </div>,
    document.body,
  )
}
