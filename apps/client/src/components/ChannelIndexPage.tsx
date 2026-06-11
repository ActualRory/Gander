import { useEffect, useState } from 'react'
import { api } from '../lib/api.ts'
import type { ChannelIndexEntry } from '@gander/shared'
import type { Channel } from '@gander/shared'
import styles from './ChannelIndexPage.module.css'

interface Props {
  token: string
  currentUserId: string
  joinedChannelIds: Set<string>
  onJoin: (channelId: string, message?: string) => Promise<void>
  onOpen: (channel: Channel) => void
  onJoinVoice: (channel: Channel) => void
  onInvite?: (channel: Channel) => void
  onClose?: () => void
}

function typeIcon(type: string): string {
  if (type === 'VOICE') return '[♪]'
  return '[#]'
}

function visibilityLabel(v: string): string {
  if (v === 'DEFAULT') return '[default]'
  if (v === 'SEMI_PUBLIC') return '[semi-public]'
  return '[public]'
}

export default function ChannelIndexPage({ token, joinedChannelIds, onJoin, onOpen, onJoinVoice, onInvite, onClose }: Props) {
  const [entries, setEntries] = useState<ChannelIndexEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [requestingId, setRequestingId] = useState<string | null>(null)
  const [requestMessages, setRequestMessages] = useState<Record<string, string>>({})
  const [pendingJoinId, setPendingJoinId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    load()
  }, [token])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getChannelIndex(token)
      setEntries(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load channel index')
    } finally {
      setLoading(false)
    }
  }

  async function handleJoin(entry: ChannelIndexEntry) {
    setPendingJoinId(entry.id)
    try {
      await onJoin(entry.id)
      // After joining, refresh the index
      const data = await api.getChannelIndex(token)
      setEntries(data)
    } finally {
      setPendingJoinId(null)
    }
  }

  async function handleRequest(entry: ChannelIndexEntry) {
    const message = requestMessages[entry.id] ?? ''
    setPendingJoinId(entry.id)
    try {
      await onJoin(entry.id, message || undefined)
      setRequestingId(null)
      setRequestMessages(prev => { const n = { ...prev }; delete n[entry.id]; return n })
      // Refresh to show pending state
      const data = await api.getChannelIndex(token)
      setEntries(data)
    } finally {
      setPendingJoinId(null)
    }
  }

  function renderAction(entry: ChannelIndexEntry) {
    const isMember = joinedChannelIds.has(entry.id) || entry.isMember

    if (isMember) {
      const channel: Channel = { id: entry.id, name: entry.name, type: entry.type, visibility: entry.visibility, isArchived: false, createdAt: entry.createdAt, creatorId: null }
      return (
        <>
          {entry.type === 'VOICE' ? (
            <button type="button" className={styles.actionBtn} onClick={() => onJoinVoice(channel)}>
              [connect]
            </button>
          ) : (
            <button type="button" className={styles.actionBtn} onClick={() => onOpen(channel)}>
              [open]
            </button>
          )}
          {onInvite && (
            <button type="button" className={styles.actionBtn} onClick={() => onInvite(channel)}>
              [invite]
            </button>
          )}
        </>
      )
    }

    if (entry.hasPendingJoinRequest) {
      return <span className={styles.pendingBadge}>[pending]</span>
    }

    if (entry.type === 'VOICE') {
      return (
        <button
          type="button"
          className={styles.actionBtn}
          disabled={pendingJoinId === entry.id}
          onClick={() => handleJoin(entry)}
        >
          {pendingJoinId === entry.id ? '[joining...]' : '[join]'}
        </button>
      )
    }

    if (entry.visibility === 'SEMI_PUBLIC') {
      if (requestingId === entry.id) {
        return (
          <div className={styles.requestForm}>
            <input
              className={styles.requestInput}
              type="text"
              placeholder="why do you want to join? (optional)"
              value={requestMessages[entry.id] ?? ''}
              onChange={e => setRequestMessages(prev => ({ ...prev, [entry.id]: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') handleRequest(entry) }}
              autoFocus
            />
            <button
              type="button"
              className={styles.actionBtn}
              disabled={pendingJoinId === entry.id}
              onClick={() => handleRequest(entry)}
            >
              {pendingJoinId === entry.id ? '[sending...]' : '[send]'}
            </button>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={() => setRequestingId(null)}
            >
              [cancel]
            </button>
          </div>
        )
      }
      return (
        <button
          type="button"
          className={styles.actionBtn}
          onClick={() => setRequestingId(entry.id)}
        >
          [request]
        </button>
      )
    }

    return (
      <button
        type="button"
        className={styles.actionBtn}
        disabled={pendingJoinId === entry.id}
        onClick={() => handleJoin(entry)}
      >
        {pendingJoinId === entry.id ? '[joining...]' : '[join]'}
      </button>
    )
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>channel index</span>
        <input
          className={styles.filterInput}
          type="text"
          placeholder="search channels..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <button type="button" className={styles.refreshBtn} onClick={load}>[refresh]</button>
        {onClose && (
          <button type="button" className={styles.closeBtn} onClick={onClose}>[×]</button>
        )}
      </div>

      {error && (
        <div className={styles.errorBanner}>
          {error}
          <button type="button" onClick={() => setError(null)}>[×]</button>
        </div>
      )}

      {(() => {
        const q = filter.trim().toLowerCase()
        const filtered = q
          ? entries.filter(e => e.name.toLowerCase().includes(q) || (e.topic ?? '').toLowerCase().includes(q))
          : entries
        if (loading) return <div className={styles.loading}>loading...</div>
        if (entries.length === 0) return <div className={styles.empty}>no channels in the public index yet.</div>
        if (filtered.length === 0) return <div className={styles.empty}>no channels match "{filter}".</div>
        return (
        <div className={styles.grid}>
          {filtered.map(entry => (
            <div key={entry.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <span className={styles.typeIcon}>{typeIcon(entry.type)}</span>
                <span className={styles.channelName}>{entry.name}</span>
                <span className={`${styles.visBadge} ${styles[`vis_${entry.visibility.toLowerCase()}`]}`}>
                  {visibilityLabel(entry.visibility)}
                </span>
              </div>
              {entry.topic && (
                <div className={styles.topic}>{entry.topic}</div>
              )}
              <div className={styles.stats}>
                {entry.type === 'VOICE' ? (
                  entry.liveParticipantCount > 0
                    ? <span className={styles.statLive}>[{entry.liveParticipantCount} live]</span>
                    : <span className={styles.stat}>[{entry.memberCount} members]</span>
                ) : (
                  <>
                    <span className={styles.stat}>[{entry.memberCount} members]</span>
                    <span className={styles.statSep}>·</span>
                    <span className={styles.stat}>[{entry.messageCount} messages]</span>
                  </>
                )}
              </div>
              <div className={styles.cardFooter}>
                {renderAction(entry)}
              </div>
            </div>
          ))}
        </div>
        )
      })()}
    </div>
  )
}
