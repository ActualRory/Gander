import { useState, useEffect, useRef } from 'react'
import type { User, SearchResult } from '@gander/shared'
import { api } from '../lib/api'
import Avatar from './Avatar.tsx'
import styles from './SocialPanel.module.css'

interface Props {
  users: User[]
  onlineUserIds: Set<string>
  userActivities: Record<string, string>
  onUserClick: (userId: string, x: number, y: number) => void
  onUserRightClick: (userId: string, x: number, y: number) => void
  token: string
  onNavigateToMessage: (channelId: string, messageId: string, createdAt: string) => void
}

function getStatus(userId: string, onlineUserIds: Set<string>, userActivities: Record<string, string>): string {
  if (!onlineUserIds.has(userId)) return 'Offline'
  return userActivities[userId] ?? 'Online'
}

const ROLE_LABELS: Record<string, string> = {
  MODERATOR: 'mod',
  ADMIN: 'admin',
  SUPERADMIN: 's.admin',
  ROOT: 'root',
}

function parseQuery(raw: string): { q: string; from?: string } {
  const fromMatch = raw.match(/\bfrom:(\S+)/i)
  const from = fromMatch?.[1]
  const q = raw.replace(/\bfrom:\S+/gi, '').trim()
  return { q, from }
}

export default function SocialPanel({ users, onlineUserIds, userActivities, onUserClick, onUserRightClick, token, onNavigateToMessage }: Props) {
  const [panelOpen, setPanelOpen] = useState(true)
  const [onlineOpen, setOnlineOpen] = useState(true)
  const [offlineOpen, setOfflineOpen] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    const { q, from } = parseQuery(searchQuery)
    if (!q) { setSearchResults([]); setIsSearching(false); return }
    setIsSearching(true)
    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await api.searchMessages(token, q, from)
        setSearchResults(results)
      } catch { setSearchResults([]) }
      setIsSearching(false)
    }, 300)
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [searchQuery, token])

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
    const status = getStatus(u.id, onlineUserIds, userActivities)
    return (
      <li
        key={u.id}
        className={`${styles.user} ${isOffline ? styles.offline : ''}`}
        onClick={e => onUserClick(u.id, e.clientX, e.clientY)}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onUserRightClick(u.id, e.clientX, e.clientY) }}
      >
        <Avatar displayName={u.displayName} userId={u.id} avatarUrl={u.avatarUrl} size={28} />
        <span className={styles.userInfo}>
          <span className={styles.userName}>
            {u.displayName}
            {ROLE_LABELS[u.role] && <span className={styles.roleTag}>[{ROLE_LABELS[u.role]}]</span>}
          </span>
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

      <div className={styles.searchBox}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="search messages..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
        />
        {searchQuery && (
          <button className={styles.searchClear} onClick={() => setSearchQuery('')}>[×]</button>
        )}
      </div>
      {searchFocused && !searchQuery && (
        <div className={styles.searchHint}>use from:username to filter by author</div>
      )}

      {searchQuery ? (
        <div className={styles.searchResults}>
          {isSearching && <div className={styles.searchStatus}>searching...</div>}
          {!isSearching && searchResults.length === 0 && <div className={styles.searchStatus}>no results</div>}
          {searchResults.map(r => (
            <div
              key={r.id}
              className={styles.searchResult}
              onClick={() => onNavigateToMessage(r.channelId, r.id, r.createdAt)}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') onNavigateToMessage(r.channelId, r.id, r.createdAt) }}
            >
              <div className={styles.searchResultMeta}>
                #{r.channelName} · {r.authorName}
                {r.postNumber != null && <span> · #{r.postNumber}</span>}
              </div>
              <div className={styles.searchResultContent}>{r.content || '[attachment]'}</div>
              <div className={styles.searchResultTime}>{new Date(r.createdAt).toLocaleString()}</div>
            </div>
          ))}
        </div>
      ) : (
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
      )}
    </div>
  )
}
