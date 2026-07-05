import { useEffect, useState } from 'react'
import type { Channel, User } from '@gander/shared'
import { api } from '../lib/api.ts'
import Avatar from './Avatar.tsx'
import { useFocusTrap } from '../lib/useFocusTrap.ts'
import styles from './InvitePeopleModal.module.css'

interface Props {
  token: string
  channel: Channel
  users: User[]
  currentUserId: string
  onClose: () => void
}

export default function InvitePeopleModal({ token, channel, users, currentUserId, onClose }: Props) {
  const trapRef = useFocusTrap<HTMLDivElement>()
  const [memberIds, setMemberIds] = useState<Set<string> | null>(null)
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set())
  const [workingId, setWorkingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    api.getChannelMembers(token, channel.id)
      .then(members => setMemberIds(new Set(members.map(m => m.userId))))
      .catch(() => setMemberIds(new Set([currentUserId])))
  }, [token, channel.id, currentUserId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function invite(userId: string) {
    setWorkingId(userId)
    setError(null)
    try {
      await api.inviteToChannel(token, channel.id, userId)
      setInvitedIds(prev => new Set([...prev, userId]))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'invite failed')
    } finally {
      setWorkingId(null)
    }
  }

  const candidates = users.filter(u =>
    !u.isBanned && !u.isArchived &&
    u.id !== currentUserId &&
    !(memberIds?.has(u.id) ?? true) &&
    (query === '' ||
      u.displayName.toLowerCase().includes(query.toLowerCase()) ||
      u.username.toLowerCase().includes(query.toLowerCase()))
  )

  return (
    <div className={styles.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.box} ref={trapRef} role="dialog" aria-modal="true" aria-label="invite people">
        <div className={styles.header}>
          <span className={styles.title}>invite people to #{channel.name}</span>
          <button type="button" className={styles.closeBtn} onClick={onClose}>[×]</button>
        </div>
        <input
          className={styles.search}
          type="text"
          placeholder="search people..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
        />
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.list}>
          {memberIds === null && <div className={styles.empty}>loading...</div>}
          {memberIds !== null && candidates.length === 0 && (
            <div className={styles.empty}>
              {query ? 'no matches' : 'everyone is already in this channel'}
            </div>
          )}
          {candidates.map(u => (
            <div key={u.id} className={styles.row}>
              <Avatar displayName={u.displayName} userId={u.id} avatarUrl={u.avatarUrl} size={28} />
              <span className={styles.rowName}>{u.displayName}</span>
              <span className={styles.rowUsername}>@{u.username}</span>
              {invitedIds.has(u.id) ? (
                <span className={styles.invitedTag}>[invited]</span>
              ) : (
                <button
                  type="button"
                  className={styles.inviteBtn}
                  disabled={workingId === u.id}
                  onClick={() => invite(u.id)}
                >
                  {workingId === u.id ? '[...]' : '[invite]'}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
