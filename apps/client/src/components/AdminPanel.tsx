import { useEffect, useState } from 'react'
import { api, resolveAttachmentUrl } from '../lib/api.ts'
import type { User, UserRole, BanRecord, ChannelIndexRequest, ChannelJoinRequest, AuditLogEntry } from '@gander/shared'
import type { Channel } from '@gander/shared'
import styles from './AdminPanel.module.css'

interface Props {
  token: string
  currentUserId: string
  currentUserRole: UserRole
}

type Tab = 'users' | 'channels' | 'password-resets' | 'join-requests' | 'audit' | 'files' | 'stats'

const RANK: Record<UserRole, number> = { MEMBER: 0, MODERATOR: 1, ADMIN: 2, SUPERADMIN: 3, ROOT: 4 }

function isAtLeast(role: UserRole, min: UserRole): boolean {
  return RANK[role] >= RANK[min]
}

function canAct(actorRole: UserRole, targetRole: UserRole): boolean {
  return RANK[actorRole] > RANK[targetRole]
}

function roleBadgeClass(role: UserRole): string {
  if (role === 'ROOT') return styles.roleRoot
  if (role === 'SUPERADMIN') return styles.roleSuperadmin
  if (role === 'ADMIN') return styles.roleAdmin
  if (role === 'MODERATOR') return styles.roleMod
  return styles.roleMember
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// ─── Users tab ───────────────────────────────────────────────────────────────

type AdminUser = User & { messageCount: number }

function UsersTab({ token, currentUserId, currentUserRole }: { token: string; currentUserId: string; currentUserRole: UserRole }) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timeoutTarget, setTimeoutTarget] = useState<string | null>(null)
  const [timeoutDuration, setTimeoutDuration] = useState('')
  const [timeoutReason, setTimeoutReason] = useState('')
  const [banTarget, setBanTarget] = useState<string | null>(null)
  const [banReason, setBanReason] = useState('')
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [renameName, setRenameName] = useState('')
  const [expandedBansId, setExpandedBansId] = useState<string | null>(null)
  const [bansCache, setBansCache] = useState<Record<string, BanRecord[]>>({})
  const [working, setWorking] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setUsers(await api.adminGetUsers(token))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  async function act(fn: () => Promise<void>) {
    setWorking(true)
    setError(null)
    try {
      await fn()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setWorking(false)
    }
  }

  async function handleTimeout(userId: string) {
    const mins = parseInt(timeoutDuration)
    if (!mins || mins < 1) return
    await act(() => api.adminTimeout(token, userId, mins, timeoutReason || undefined))
    setTimeoutTarget(null)
    setTimeoutDuration('')
    setTimeoutReason('')
  }

  async function handleClearTimeout(userId: string) {
    await act(() => api.adminClearTimeout(token, userId))
  }

  async function handleBan(userId: string) {
    await act(() => api.adminBanUser(token, userId, banReason || undefined))
    setBanTarget(null)
    setBanReason('')
  }

  async function handleUnban(userId: string) {
    await act(() => api.adminUnbanUser(token, userId))
  }

  async function handleSetRole(userId: string, role: UserRole) {
    await act(() => api.adminSetRole(token, userId, role))
  }

  async function handleRename(userId: string) {
    if (!renameName.trim()) return
    await act(() => api.adminSetDisplayName(token, userId, renameName.trim()))
    setRenameTarget(null)
    setRenameName('')
  }

  async function handleExpandBans(userId: string) {
    if (expandedBansId === userId) { setExpandedBansId(null); return }
    try {
      const bans = await api.adminGetUserBans(token, userId)
      setBansCache(prev => ({ ...prev, [userId]: bans }))
    } catch { /* ignore */ }
    setExpandedBansId(userId)
  }

  const isAdmin = isAtLeast(currentUserRole, 'ADMIN')
  const isSuperadmin = isAtLeast(currentUserRole, 'SUPERADMIN')

  if (loading) return <div className={styles.loading}>loading...</div>

  return (
    <div className={styles.tabContent}>
      {error && <div className={styles.errorBanner}>{error} <button onClick={() => setError(null)}>[×]</button></div>}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>user</th>
            <th>role</th>
            <th>status</th>
            <th>joined</th>
            <th>messages</th>
            <th>actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map(user => {
            const isSelf = user.id === currentUserId
            const canActOn = !isSelf && canAct(currentUserRole, user.role)
            const isTimedOut = user.timeoutUntil ? new Date(user.timeoutUntil) > new Date() : false

            return (
              <>
                <tr key={user.id} className={user.isBanned ? styles.bannedRow : undefined}>
                  <td>
                    <div className={styles.userCell}>
                      <span className={styles.displayName}>{user.displayName}</span>
                      <span className={styles.username}>{user.username}</span>
                    </div>
                  </td>
                  <td>
                    <span className={`${styles.roleBadge} ${roleBadgeClass(user.role)}`}>{user.role.toLowerCase()}</span>
                  </td>
                  <td>
                    {user.isBanned && <span className={styles.bannedBadge}>[banned]</span>}
                    {isTimedOut && !user.isBanned && (
                      <span className={styles.timedOutBadge} title={`until ${formatDateTime(user.timeoutUntil!)}`}>[timed out]</span>
                    )}
                    {!user.isBanned && !isTimedOut && <span className={styles.okBadge}>—</span>}
                  </td>
                  <td className={styles.dateCell}>{formatDate(user.createdAt)}</td>
                  <td className={styles.numCell}>{user.messageCount}</td>
                  <td>
                    <div className={styles.actions}>
                      {canActOn && !user.isBanned && (
                        <>
                          {isTimedOut ? (
                            <button className={styles.actBtn} disabled={working} onClick={() => handleClearTimeout(user.id)}>[untimeout]</button>
                          ) : (
                            <button className={styles.actBtn} disabled={working} onClick={() => { setTimeoutTarget(user.id); setTimeoutDuration(''); setTimeoutReason('') }}>[timeout]</button>
                          )}
                          {isAdmin && (
                            <button className={`${styles.actBtn} ${styles.dangerBtn}`} disabled={working} onClick={() => { setBanTarget(user.id); setBanReason('') }}>[ban]</button>
                          )}
                        </>
                      )}
                      {canActOn && user.isBanned && isAdmin && (
                        <button className={styles.actBtn} disabled={working} onClick={() => handleUnban(user.id)}>[unban]</button>
                      )}
                      {isAdmin && !isSelf && canActOn && (
                        <button className={styles.actBtn} disabled={working} onClick={() => { setRenameTarget(user.id); setRenameName(user.displayName) }}>[rename]</button>
                      )}
                      {user.isBanned && (
                        <button className={styles.actBtn} disabled={working} onClick={() => handleExpandBans(user.id)}>[bans]</button>
                      )}
                      {isAdmin && canActOn && (
                        <select
                          className={styles.roleSelect}
                          value={user.role}
                          disabled={working}
                          onChange={e => handleSetRole(user.id, e.target.value as UserRole)}
                        >
                          <option value="MEMBER">member</option>
                          <option value="MODERATOR">moderator</option>
                          {isSuperadmin && <option value="ADMIN">admin</option>}
                          {currentUserRole === 'ROOT' && <option value="SUPERADMIN">superadmin</option>}
                        </select>
                      )}
                    </div>
                  </td>
                </tr>
                {timeoutTarget === user.id && (
                  <tr key={`${user.id}-timeout`} className={styles.inlineFormRow}>
                    <td colSpan={6}>
                      <div className={styles.inlineForm}>
                        <span className={styles.formLabel}>timeout {user.displayName}:</span>
                        <input
                          className={styles.formInput}
                          type="number"
                          min="1"
                          max={isAdmin ? 99999 : 2880}
                          placeholder={`minutes (max ${isAdmin ? '∞' : '2880'})`}
                          value={timeoutDuration}
                          onChange={e => setTimeoutDuration(e.target.value)}
                        />
                        <input
                          className={styles.formInput}
                          type="text"
                          placeholder="reason (optional)"
                          value={timeoutReason}
                          onChange={e => setTimeoutReason(e.target.value)}
                        />
                        <button className={styles.actBtn} disabled={working} onClick={() => handleTimeout(user.id)}>[apply]</button>
                        <button className={styles.cancelBtn} onClick={() => setTimeoutTarget(null)}>[cancel]</button>
                      </div>
                    </td>
                  </tr>
                )}
                {banTarget === user.id && (
                  <tr key={`${user.id}-ban`} className={styles.inlineFormRow}>
                    <td colSpan={6}>
                      <div className={styles.inlineForm}>
                        <span className={styles.formLabel}>ban {user.displayName}:</span>
                        <input
                          className={styles.formInput}
                          type="text"
                          placeholder="reason (optional)"
                          value={banReason}
                          onChange={e => setBanReason(e.target.value)}
                        />
                        <button className={`${styles.actBtn} ${styles.dangerBtn}`} disabled={working} onClick={() => handleBan(user.id)}>[confirm ban]</button>
                        <button className={styles.cancelBtn} onClick={() => setBanTarget(null)}>[cancel]</button>
                      </div>
                    </td>
                  </tr>
                )}
                {renameTarget === user.id && (
                  <tr key={`${user.id}-rename`} className={styles.inlineFormRow}>
                    <td colSpan={6}>
                      <div className={styles.inlineForm}>
                        <span className={styles.formLabel}>rename {user.displayName}:</span>
                        <input
                          className={styles.formInput}
                          type="text"
                          value={renameName}
                          onChange={e => setRenameName(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleRename(user.id)}
                        />
                        <button className={styles.actBtn} disabled={working} onClick={() => handleRename(user.id)}>[save]</button>
                        <button className={styles.cancelBtn} onClick={() => setRenameTarget(null)}>[cancel]</button>
                      </div>
                    </td>
                  </tr>
                )}
                {expandedBansId === user.id && bansCache[user.id] && (
                  <tr key={`${user.id}-bans`} className={styles.inlineFormRow}>
                    <td colSpan={6}>
                      <div className={styles.bansExpanded}>
                        <div className={styles.bansTitle}>ban history for {user.displayName}</div>
                        {bansCache[user.id].length === 0 ? (
                          <div className={styles.emptySmall}>no bans on record</div>
                        ) : (
                          bansCache[user.id].map(b => (
                            <div key={b.id} className={styles.banEntry}>
                              <span className={b.active ? styles.bannedBadge : styles.okBadge}>{b.active ? '[active]' : '[lifted]'}</span>
                              <span className={styles.banDate}>{formatDateTime(b.bannedAt)}</span>
                              <span className={styles.banIssuer}>by {b.issuedByName}</span>
                              {b.reason && <span className={styles.banReason}>"{b.reason}"</span>}
                            </div>
                          ))
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Channels tab ─────────────────────────────────────────────────────────────

type AdminChannel = Channel & { memberCount: number; messageCount: number }

function ChannelsTab({ token, currentUserRole }: { token: string; currentUserRole: UserRole }) {
  const [channels, setChannels] = useState<AdminChannel[]>([])
  const [requests, setRequests] = useState<ChannelIndexRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [section, setSection] = useState<'all' | 'requests'>('all')
  const [newChannelName, setNewChannelName] = useState('')
  const [newChannelType, setNewChannelType] = useState<'TEXT' | 'VOICE'>('TEXT')
  const [creating, setCreating] = useState(false)

  useEffect(() => { load() }, [section])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      if (section === 'all') {
        setChannels(await api.adminGetChannels(token))
      } else {
        setRequests(await api.adminGetIndexRequests(token))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  async function act(fn: () => Promise<void>) {
    setWorking(true)
    setError(null)
    try {
      await fn()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setWorking(false)
    }
  }

  const isAdmin = isAtLeast(currentUserRole, 'ADMIN')
  const isSuperadmin = isAtLeast(currentUserRole, 'SUPERADMIN')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newChannelName.trim()) return
    setCreating(true)
    try {
      await api.createChannel(token, newChannelName.trim(), newChannelType)
      setNewChannelName('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className={styles.tabContent}>
      {error && <div className={styles.errorBanner}>{error} <button onClick={() => setError(null)}>[×]</button></div>}
      {isAdmin && (
        <form onSubmit={handleCreate} className={styles.createChannelForm}>
          <select
            value={newChannelType}
            onChange={e => setNewChannelType(e.target.value as 'TEXT' | 'VOICE')}
            className={styles.typeSelect}
          >
            <option value="TEXT"># text</option>
            <option value="VOICE">▸ voice</option>
          </select>
          <input
            placeholder="channel-name"
            value={newChannelName}
            onChange={e => setNewChannelName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
            className={styles.createChannelInput}
          />
          <button type="submit" className={styles.actBtn} disabled={creating || !newChannelName.trim()}>
            {creating ? 'creating...' : '[+ new channel]'}
          </button>
        </form>
      )}
      <div className={styles.subTabs}>
        <button className={section === 'all' ? styles.subTabActive : styles.subTab} onClick={() => setSection('all')}>[all channels]</button>
        <button className={section === 'requests' ? styles.subTabActive : styles.subTab} onClick={() => setSection('requests')}>[index requests]</button>
      </div>
      {loading ? <div className={styles.loading}>loading...</div> : section === 'all' ? (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>channel</th>
              <th>type</th>
              <th>visibility</th>
              <th>members</th>
              <th>messages</th>
              <th>status</th>
              <th>actions</th>
            </tr>
          </thead>
          <tbody>
            {channels.map(ch => (
              <tr key={ch.id} className={ch.isArchived ? styles.archivedRow : undefined}>
                <td className={styles.nameCell}>{ch.name}</td>
                <td className={styles.typeCell}>{ch.type.toLowerCase()}</td>
                <td><span className={styles.visBadge}>{ch.visibility.toLowerCase().replace('_', '-')}</span></td>
                <td className={styles.numCell}>{ch.memberCount}</td>
                <td className={styles.numCell}>{ch.messageCount}</td>
                <td>{ch.isArchived ? <span className={styles.archivedBadge}>[archived]</span> : '—'}</td>
                <td>
                  <div className={styles.actions}>
                    {!ch.isArchived ? (
                      <button className={styles.actBtn} disabled={working} onClick={() => act(() => api.adminUpdateChannel(token, ch.id, { isArchived: true }))}>[archive]</button>
                    ) : (
                      <button className={styles.actBtn} disabled={working} onClick={() => act(() => api.adminUpdateChannel(token, ch.id, { isArchived: false }))}>[restore]</button>
                    )}
                    {isSuperadmin && (
                      <select
                        className={styles.roleSelect}
                        value={ch.visibility}
                        disabled={working}
                        onChange={e => act(() => api.adminUpdateChannel(token, ch.id, { visibility: e.target.value }))}
                      >
                        <option value="PRIVATE">private</option>
                        <option value="PUBLIC">public</option>
                        <option value="SEMI_PUBLIC">semi-public</option>
                        <option value="DEFAULT">default</option>
                      </select>
                    )}
                    {isAdmin && (
                      <button className={`${styles.actBtn} ${styles.dangerBtn}`} disabled={working} onClick={() => { if (confirm(`Delete #${ch.name}? This cannot be undone.`)) act(() => api.adminDeleteChannel(token, ch.id)) }}>[delete]</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>channel</th>
              <th>requested by</th>
              <th>visibility</th>
              <th>date</th>
              <th>actions</th>
            </tr>
          </thead>
          <tbody>
            {requests.length === 0 ? (
              <tr><td colSpan={5} className={styles.emptyCell}>no pending index requests</td></tr>
            ) : requests.map(req => (
              <tr key={req.id}>
                <td className={styles.nameCell}>{req.channelName}</td>
                <td>{req.requestedByName}</td>
                <td><span className={styles.visBadge}>{req.requestedVisibility.toLowerCase().replace('_', '-')}</span></td>
                <td className={styles.dateCell}>{formatDate(req.createdAt)}</td>
                <td>
                  <div className={styles.actions}>
                    <button className={styles.actBtn} disabled={working} onClick={() => act(() => api.adminApproveIndex(token, req.id, req.requestedVisibility))}>[approve]</button>
                    <button className={`${styles.actBtn} ${styles.dangerBtn}`} disabled={working} onClick={() => act(() => api.adminRejectIndex(token, req.id))}>[reject]</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ─── Password reset requests tab ──────────────────────────────────────────────

type ResetRequest = { id: string; userId: string; username: string; displayName: string; createdAt: string }

function PasswordResetsTab({ token }: { token: string }) {
  const [requests, setRequests] = useState<ResetRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      setRequests(await api.adminGetPasswordResets(token))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  async function act(fn: () => Promise<void>) {
    setWorking(true)
    setError(null)
    try { await fn(); await load() }
    catch (err) { setError(err instanceof Error ? err.message : 'Action failed') }
    finally { setWorking(false) }
  }

  return (
    <div className={styles.tabContent}>
      {error && <div className={styles.errorBanner}>{error} <button onClick={() => setError(null)}>[×]</button></div>}
      {loading ? <div className={styles.loading}>loading...</div> : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>user</th>
              <th>username</th>
              <th>requested</th>
              <th>actions</th>
            </tr>
          </thead>
          <tbody>
            {requests.length === 0 ? (
              <tr><td colSpan={4} className={styles.emptyCell}>no pending password reset requests</td></tr>
            ) : requests.map(r => (
              <tr key={r.id}>
                <td className={styles.nameCell}>{r.displayName}</td>
                <td>{r.username}</td>
                <td className={styles.dateCell}>{formatDateTime(r.createdAt)}</td>
                <td>
                  <div className={styles.actions}>
                    <button className={styles.actBtn} disabled={working} onClick={() => act(() => api.adminApprovePasswordReset(token, r.id))}>[approve]</button>
                    <button className={`${styles.actBtn} ${styles.dangerBtn}`} disabled={working} onClick={() => act(() => api.adminRejectPasswordReset(token, r.id))}>[reject]</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ─── Join requests tab ────────────────────────────────────────────────────────

function JoinRequestsTab({ token }: { token: string }) {
  const [requests, setRequests] = useState<ChannelJoinRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      setRequests(await api.adminGetJoinRequests(token))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  async function act(fn: () => Promise<void>) {
    setWorking(true)
    setError(null)
    try {
      await fn()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setWorking(false)
    }
  }

  if (loading) return <div className={styles.loading}>loading...</div>

  return (
    <div className={styles.tabContent}>
      {error && <div className={styles.errorBanner}>{error} <button onClick={() => setError(null)}>[×]</button></div>}
      {requests.length === 0 ? (
        <div className={styles.empty}>no pending join requests.</div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>user</th>
              <th>channel</th>
              <th>message</th>
              <th>date</th>
              <th>actions</th>
            </tr>
          </thead>
          <tbody>
            {requests.map(req => (
              <tr key={req.id}>
                <td>
                  <div className={styles.userCell}>
                    <span className={styles.displayName}>{req.displayName}</span>
                    <span className={styles.username}>{req.username}</span>
                  </div>
                </td>
                <td className={styles.nameCell}>{req.channelName}</td>
                <td className={styles.messageCell}>{req.message ?? <span className={styles.emptySmall}>—</span>}</td>
                <td className={styles.dateCell}>{formatDate(req.createdAt)}</td>
                <td>
                  <div className={styles.actions}>
                    <button className={styles.actBtn} disabled={working} onClick={() => act(() => api.adminApproveJoinRequest(token, req.id))}>[approve]</button>
                    <button className={`${styles.actBtn} ${styles.dangerBtn}`} disabled={working} onClick={() => act(() => api.adminRejectJoinRequest(token, req.id))}>[reject]</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ─── Audit log tab ────────────────────────────────────────────────────────────

function AuditTab({ token }: { token: string }) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterAction, setFilterAction] = useState('')
  const [before, setBefore] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)

  useEffect(() => { loadFresh() }, [filterAction])

  async function loadFresh() {
    setLoading(true)
    setError(null)
    setBefore(undefined)
    try {
      const data = await api.adminGetAuditLog(token, { action: filterAction || undefined, limit: 50 })
      setEntries(data)
      setHasMore(data.length === 50)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  async function loadMore() {
    if (!entries.length) return
    const cursor = entries[entries.length - 1].createdAt
    try {
      const data = await api.adminGetAuditLog(token, { action: filterAction || undefined, before: cursor, limit: 50 })
      setEntries(prev => [...prev, ...data])
      setBefore(cursor)
      setHasMore(data.length === 50)
    } catch { /* ignore */ }
  }

  return (
    <div className={styles.tabContent}>
      {error && <div className={styles.errorBanner}>{error} <button onClick={() => setError(null)}>[×]</button></div>}
      <div className={styles.filterBar}>
        <span className={styles.filterLabel}>filter:</span>
        <input
          className={styles.filterInput}
          type="text"
          placeholder="action (e.g. user.ban, message.delete)"
          value={filterAction}
          onChange={e => setFilterAction(e.target.value)}
        />
        <button className={styles.actBtn} onClick={loadFresh}>[search]</button>
      </div>
      {loading ? (
        <div className={styles.loading}>loading...</div>
      ) : entries.length === 0 ? (
        <div className={styles.empty}>no audit log entries.</div>
      ) : (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>time</th>
                <th>actor</th>
                <th>action</th>
                <th>target</th>
                <th>detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => (
                <tr key={entry.id}>
                  <td className={styles.dateCell}>{formatDateTime(entry.createdAt)}</td>
                  <td>{entry.actorName ?? <span className={styles.emptySmall}>system</span>}</td>
                  <td><code className={styles.actionCode}>{entry.action}</code></td>
                  <td className={styles.targetCell}>
                    {entry.targetType && entry.targetId ? `${entry.targetType}:${entry.targetId.slice(0, 8)}…` : '—'}
                  </td>
                  <td className={styles.metaCell}>
                    {entry.meta ? JSON.stringify(entry.meta) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasMore && (
            <div className={styles.loadMoreRow}>
              <button className={styles.actBtn} onClick={loadMore}>[load more]</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Files tab ────────────────────────────────────────────────────────────────

type FileEntry = { id: string; filename: string; mimeType: string; size: number; uploadedAt: string; uploaderName: string; url: string; channel: { id: string; name: string; type: string } | null }

function mimeShort(mime: string): string {
  const map: Record<string, string> = { 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/gif': 'GIF', 'image/webp': 'WEBP', 'application/pdf': 'PDF', 'text/plain': 'TXT', 'application/zip': 'ZIP' }
  return map[mime] ?? mime.split('/')[1]?.toUpperCase().slice(0, 6) ?? '?'
}

function FilesTab({ token }: { token: string }) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [fileStats, setFileStats] = useState<{ totalSize: number; fileCount: number; limitBytes: number | null } | null>(null)
  const [sort, setSort] = useState<string>('uploadedAt')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)

  useEffect(() => { loadFresh() }, [sort])

  async function loadFresh() {
    setLoading(true)
    setError(null)
    try {
      const [res, stats] = await Promise.all([
        api.adminGetFiles(token, { sort, limit: 100 }),
        api.adminGetFileStats(token),
      ])
      setFiles(res.files)
      setNextCursor(res.nextCursor)
      setFileStats(stats)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files')
    } finally {
      setLoading(false)
    }
  }

  async function loadMore() {
    if (!nextCursor) return
    try {
      const res = await api.adminGetFiles(token, { sort, limit: 100, cursor: nextCursor })
      setFiles(prev => [...prev, ...res.files])
      setNextCursor(res.nextCursor)
    } catch { /* ignore */ }
  }

  const usagePercent = fileStats?.limitBytes ? (fileStats.totalSize / fileStats.limitBytes) * 100 : 0
  const isDanger = usagePercent > 80

  return (
    <div className={styles.tabContent}>
      {error && <div className={styles.errorBanner}>{error} <button onClick={() => setError(null)}>[×]</button></div>}
      {fileStats && (
        <div className={styles.storageSection}>
          <div className={styles.storageLabel}>
            storage: {formatSize(fileStats.totalSize)} used · {fileStats.fileCount} files
            {fileStats.limitBytes && ` · limit ${formatSize(fileStats.limitBytes)}`}
          </div>
          {fileStats.limitBytes && (
            <div className={styles.storageBarTrack}>
              <div className={`${styles.storageBarFill} ${isDanger ? styles.storageBarDanger : ''}`} style={{ width: `${Math.min(100, usagePercent)}%` }} />
            </div>
          )}
        </div>
      )}
      <div className={styles.sortBar}>
        <span className={styles.sortLabel}>sort:</span>
        {['uploadedAt', 'size', 'type'].map(f => (
          <button key={f} className={`${styles.sortBtn} ${sort === f ? styles.sortBtnActive : ''}`} onClick={() => setSort(f)}>[{f}]</button>
        ))}
      </div>
      {loading ? (
        <div className={styles.loading}>loading...</div>
      ) : (
        <>
          <div className={styles.fileList}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>file</th>
                  <th>type</th>
                  <th>size</th>
                  <th>uploader</th>
                  <th>channel</th>
                  <th>date</th>
                </tr>
              </thead>
              <tbody>
                {files.map(file => (
                  <tr key={file.id}>
                    <td className={styles.fileNameCell}>
                      <a className={styles.fileLink} href={resolveAttachmentUrl(file.url)} target="_blank" rel="noreferrer">{file.filename}</a>
                    </td>
                    <td className={styles.typeCell}>{mimeShort(file.mimeType)}</td>
                    <td className={styles.numCell}>{formatSize(file.size)}</td>
                    <td>{file.uploaderName}</td>
                    <td className={styles.nameCell}>{file.channel ? (file.channel.type === 'DM' ? 'DM' : `#${file.channel.name}`) : '—'}</td>
                    <td className={styles.dateCell}>{formatDate(file.uploadedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {nextCursor && (
            <div className={styles.loadMoreRow}>
              <button className={styles.actBtn} onClick={loadMore}>[load more]</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Stats tab ────────────────────────────────────────────────────────────────

function StatsTab({ token }: { token: string }) {
  const [stats, setStats] = useState<{ userCount: number; messageCount: number; channelCount: number; totalAttachmentBytes: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.adminGetStats(token).then(setStats).catch(err => setError(err instanceof Error ? err.message : 'Failed')).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className={styles.loading}>loading...</div>
  if (error) return <div className={styles.errorBanner}>{error}</div>
  if (!stats) return null

  return (
    <div className={styles.tabContent}>
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{stats.userCount}</div>
          <div className={styles.statLabel}>users</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{stats.channelCount}</div>
          <div className={styles.statLabel}>channels</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{stats.messageCount.toLocaleString()}</div>
          <div className={styles.statLabel}>messages</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{formatSize(stats.totalAttachmentBytes)}</div>
          <div className={styles.statLabel}>attachments</div>
        </div>
      </div>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; minRole: UserRole }[] = [
  { id: 'users', label: 'users', minRole: 'MODERATOR' },
  { id: 'channels', label: 'channels', minRole: 'MODERATOR' },
  { id: 'password-resets', label: 'password resets', minRole: 'SUPERADMIN' },
  { id: 'join-requests', label: 'join requests', minRole: 'MODERATOR' },
  { id: 'audit', label: 'audit log', minRole: 'MODERATOR' },
  { id: 'files', label: 'files', minRole: 'MODERATOR' },
  { id: 'stats', label: 'stats', minRole: 'MODERATOR' },
]

export default function AdminPanel({ token, currentUserId, currentUserRole }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('users')

  const visibleTabs = TABS.filter(t => isAtLeast(currentUserRole, t.minRole))

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>admin panel</span>
        <span className={styles.roleTag}>{currentUserRole.toLowerCase()}</span>
      </div>
      <div className={styles.tabs}>
        {visibleTabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? styles.tabActive : styles.tab}
            onClick={() => setActiveTab(tab.id)}
          >
            [{tab.label}]
          </button>
        ))}
      </div>
      <div className={styles.body}>
        {activeTab === 'users' && <UsersTab token={token} currentUserId={currentUserId} currentUserRole={currentUserRole} />}
        {activeTab === 'channels' && <ChannelsTab token={token} currentUserRole={currentUserRole} />}
        {activeTab === 'password-resets' && <PasswordResetsTab token={token} />}
        {activeTab === 'join-requests' && <JoinRequestsTab token={token} />}
        {activeTab === 'audit' && <AuditTab token={token} />}
        {activeTab === 'files' && <FilesTab token={token} />}
        {activeTab === 'stats' && <StatsTab token={token} />}
      </div>
    </div>
  )
}
