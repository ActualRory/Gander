import { useEffect, useRef, useState } from 'react'
import type { Channel, Notification, User, UserRole } from '@gander/shared'
import { platform } from '../lib/platform.ts'
import { useDrawerSwipe } from '../lib/useDrawerSwipe.ts'
import { useLongPress } from '../lib/useLongPress.ts'
import { useMediaQuery, MOBILE_LAYOUT } from '../lib/useMediaQuery.ts'
import ContextMenu, { type ContextMenuItem } from './ContextMenu.tsx'
import ChannelIndexModal from './ChannelIndexModal.tsx'
import ConfirmDeleteModal from './ConfirmDeleteModal.tsx'
import CreateChannelModal from './CreateChannelModal.tsx'
import VoiceControls, { type VoiceStats } from './VoiceControls.tsx'
import ParticipantVolumeMenu from './ParticipantVolumeMenu.tsx'
import NotificationInbox from './NotificationInbox.tsx'
import styles from './Sidebar.module.css'

interface Props {
  channels: Channel[]
  dmChannels: Channel[]
  activeChannelId: string | null
  currentUserId: string
  hiddenChannelIds: Set<string>
  unreadCounts: Record<string, number>
  mentionCounts: Record<string, number>
  mutedChannelIds: Set<string>
  users: User[]
  onlineUserIds: Set<string>
  voiceChannelId: string | null
  voiceParticipants: Record<string, string[]>
  voiceChannelStartTimes: Record<string, number>
  isMuted: boolean
  isDeafened: boolean
  isSpeaking: boolean
  isReceiving: boolean
  speakingUserIds: Set<string>
  onSelectChannel: (channel: Channel) => void
  onCreateChannel: (name: string, type: 'TEXT' | 'VOICE') => void
  onRenameChannel: (channelId: string, name: string) => void
  onDeleteChannel: (channelId: string) => void
  onArchiveChannel?: (channelId: string) => void
  onLeaveChannel?: (channelId: string) => void
  onHideChannel: (channelId: string) => void
  onToggleChannelVisibility: (channelId: string) => void
  onMarkRead: (channelId: string) => void
  onToggleMuted: (channelId: string) => void
  onJoinVoice: (channel: Channel) => void
  onLeaveVoice: () => void
  onToggleMute: () => void
  onToggleDeafen: () => void
  isCameraOn: boolean
  isScreenSharing: boolean
  onToggleCamera: () => void
  onToggleScreenShare: () => void
  voiceStats: VoiceStats | null
  onOpenSettings: () => void
  onOpenDM: (channel: Channel) => void
  onHideDM: (channelId: string) => void
  onSetTopic: (channelId: string, topic: string) => void
  displayName: string
  participantVolumes: Record<string, number>
  onSetParticipantVolume: (userId: string, vol: number) => void
  participantVoiceState: Record<string, { muted: boolean; deafened: boolean; videoEnabled: boolean; screenSharing: boolean }>
  onWatchStream: (userId: string, type: 'screen' | 'camera') => void
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
  onOpenQuickSwitcher: () => void
  pttEnabled: boolean
  onPttDown: () => void
  onPttUp: () => void
  hiddenUtilityIds: Set<string>
  onToggleUtilityVisibility: (id: string) => void
  onOpenUtility: (id: 'library' | 'file-manager' | 'gandle' | 'admin') => void
  activeUtilityId: string | null
  onBrowseChannels: () => void
  currentUserRole: UserRole
  token: string
  notifications: Notification[]
  onMarkNotificationRead: (id: string) => void
  onMarkAllNotificationsRead: () => void
  onNotificationClick: (n: Notification) => void
  onInvitePeople: (channel: Channel) => void
  channelsLoading: boolean
  channelsError: string | null
  onRetryChannels: () => void
  voiceConnectingChannelId: string | null
}

interface ContextState {
  x: number
  y: number
  channel: Channel
}

interface ParticipantVolumeState {
  x: number
  y: number
  userId: string
  userName: string
}

const UTILITIES = [
  { id: 'library' as const, label: 'the library' },
  { id: 'gandle' as const, label: 'gandle' },
]

const MOD_ROLES: UserRole[] = ['MODERATOR', 'ADMIN', 'SUPERADMIN', 'ROOT']
const ADMIN_ROLES: UserRole[] = ['ADMIN', 'SUPERADMIN', 'ROOT']

function isMod(role: UserRole) { return MOD_ROLES.includes(role) }
function isAdmin(role: UserRole) { return ADMIN_ROLES.includes(role) }

export default function Sidebar({ channels, dmChannels, activeChannelId, currentUserId, hiddenChannelIds, unreadCounts, mentionCounts, mutedChannelIds, users, onlineUserIds, voiceChannelId, voiceParticipants, voiceChannelStartTimes, isMuted, isDeafened, isSpeaking, isReceiving, speakingUserIds, voiceStats, onSelectChannel, onCreateChannel, onRenameChannel, onDeleteChannel, onArchiveChannel, onLeaveChannel, onHideChannel, onToggleChannelVisibility, onMarkRead, onToggleMuted, onJoinVoice, onLeaveVoice, onToggleMute, onToggleDeafen, isCameraOn, isScreenSharing, onToggleCamera, onToggleScreenShare, onOpenSettings, onOpenDM, onHideDM, onSetTopic, displayName, participantVolumes, onSetParticipantVolume, participantVoiceState, onWatchStream, isOpen, onOpen, onClose, onOpenQuickSwitcher, pttEnabled, onPttDown, onPttUp, hiddenUtilityIds, onToggleUtilityVisibility, onOpenUtility, activeUtilityId, onBrowseChannels, currentUserRole, token, notifications, onMarkNotificationRead, onMarkAllNotificationsRead, onNotificationClick, onInvitePeople, channelsLoading, channelsError, onRetryChannels, voiceConnectingChannelId }: Props) {
  const [indexOpen, setIndexOpen] = useState(false)
  const [creating, setCreating] = useState<'TEXT' | 'VOICE' | null>(null)
  const [context, setContext] = useState<ContextState | null>(null)
  const [participantVolumeMenu, setParticipantVolumeMenu] = useState<ParticipantVolumeState | null>(null)
  const [renaming, setRenaming] = useState<Channel | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [settingTopic, setSettingTopic] = useState<Channel | null>(null)
  const [topicValue, setTopicValue] = useState('')
  const [deleting, setDeleting] = useState<Channel | null>(null)
  const [utilityContext, setUtilityContext] = useState<{ id: string; label: string; x: number; y: number } | null>(null)
  const renameRef = useRef<HTMLInputElement>(null)
  const topicRef = useRef<HTMLInputElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const isMobileLayout = useMediaQuery(MOBILE_LAYOUT)
  useDrawerSwipe({ side: 'left', isOpen, onOpen, onClose, drawerRef, enabled: isMobileLayout })
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const [appVersion, setAppVersion] = useState<string | null>(null)
  useEffect(() => {
    if (!platform.isTauri) return
    import('@tauri-apps/api/app').then(({ getVersion }) => getVersion().then(setAppVersion))
  }, [])

  const visibleText = channels.filter(c => c.type === 'TEXT' && !hiddenChannelIds.has(c.id))
  const visibleVoice = channels.filter(c => c.type === 'VOICE' && !hiddenChannelIds.has(c.id))
  const visibleDMs = dmChannels.filter(c => !hiddenChannelIds.has(c.id))
  const visibleUtilities = UTILITIES.filter(u => !hiddenUtilityIds.has(u.id))

  // Long-press: single timer + channel ref handles all channel buttons
  const lpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function startLongPress(e: React.PointerEvent, channel: Channel) {
    const { clientX, clientY } = e
    lpTimerRef.current = setTimeout(() => {
      lpTimerRef.current = null
      setContext({ x: clientX, y: clientY, channel })
    }, 500)
  }
  function cancelLongPress() {
    if (lpTimerRef.current !== null) { clearTimeout(lpTimerRef.current); lpTimerRef.current = null }
  }

  // Touch parity for the right-click-only participant volume menu (one shared
  // instance; the pressed participant is stashed on pointerdown)
  const participantLongPressTarget = useRef<{ userId: string; userName: string } | null>(null)
  const participantLongPress = useLongPress((x, y) => {
    const t = participantLongPressTarget.current
    if (t) setParticipantVolumeMenu({ x, y, userId: t.userId, userName: t.userName })
  })

  function handleContextMenu(e: React.MouseEvent, channel: Channel) {
    e.preventDefault()
    e.stopPropagation()
    setContext({ x: e.clientX, y: e.clientY, channel })
  }

  function startRename(channel: Channel) {
    setRenaming(channel)
    setRenameValue(channel.name)
  }

  function submitRename(e: React.FormEvent) {
    e.preventDefault()
    if (!renaming || !renameValue.trim()) return
    onRenameChannel(renaming.id, renameValue.trim())
    setRenaming(null)
  }

  function submitTopic(e: React.FormEvent) {
    e.preventDefault()
    if (!settingTopic) return
    onSetTopic(settingTopic.id, topicValue)
    setSettingTopic(null)
  }

  function contextItems(channel: Channel): ContextMenuItem[] {
    const hasUnread = (unreadCounts[channel.id] ?? 0) > 0
    if (channel.type === 'DM') {
      return [
        { label: 'hide', action: () => onHideDM(channel.id) },
        { label: 'mark as read', disabled: !hasUnread, action: () => onMarkRead(channel.id) },
        {
          label: mutedChannelIds.has(channel.id) ? 'unmute notifications' : 'mute notifications',
          action: () => onToggleMuted(channel.id),
        },
      ]
    }
    const items: ContextMenuItem[] = [
      { label: 'hide', action: () => onHideChannel(channel.id) },
      { label: 'mark as read', disabled: !hasUnread, action: () => onMarkRead(channel.id) },
      {
        label: mutedChannelIds.has(channel.id) ? 'unmute notifications' : 'mute notifications',
        action: () => onToggleMuted(channel.id),
      },
    ]
    items.push({ label: 'copy link', action: () => void navigator.clipboard.writeText(`#${channel.name}`) })
    items.push({ label: 'invite people', action: () => onInvitePeople(channel) })
    // Creator, channel MANAGER, or global mod — mirrors the server's canManageChannel
    const canManage = channel.creatorId === currentUserId || channel.memberRole === 'MANAGER' || isMod(currentUserRole)
    if (canManage) {
      items.push({ label: 'rename', action: () => startRename(channel) })
      if (channel.type === 'TEXT') {
        items.push({ label: 'set topic', action: () => { setSettingTopic(channel); setTopicValue(channel.topic ?? '') } })
      }
    }
    if (canManage && !channel.isArchived) {
      items.push({ label: 'archive', action: () => onArchiveChannel?.(channel.id) })
    }
    if (channel.creatorId !== currentUserId) {
      items.push({ label: 'leave', danger: true, action: () => onLeaveChannel?.(channel.id) })
    }
    if (channel.creatorId === currentUserId && channel.visibility === 'PRIVATE') {
      items.push({ label: 'delete', danger: true, action: () => setDeleting(channel) })
    } else if (isAdmin(currentUserRole)) {
      items.push({ label: 'delete', danger: true, action: () => setDeleting(channel) })
    }
    return items
  }

  function getDMStatus(channel: Channel): 'chatting' | 'online' | 'offline' {
    const otherId = channel.otherUserId
    if (!otherId) return 'offline'
    const inVoice = Object.values(voiceParticipants).some(ids => ids.includes(otherId))
    if (inVoice) return 'chatting'
    if (onlineUserIds.has(otherId)) return 'online'
    return 'offline'
  }

  function renderTextChannel(c: Channel) {
    if (renaming?.id === c.id) {
      return (
        <form key={c.id} onSubmit={submitRename} className={styles.renameForm}>
          <input
            ref={renameRef}
            autoFocus
            value={renameValue}
            onChange={e => setRenameValue(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
            onBlur={() => setRenaming(null)}
            onKeyDown={e => e.key === 'Escape' && setRenaming(null)}
          />
        </form>
      )
    }
    if (settingTopic?.id === c.id) {
      return (
        <form key={c.id} onSubmit={submitTopic} className={styles.renameForm}>
          <input
            ref={topicRef}
            autoFocus
            placeholder="topic (empty to clear)"
            value={topicValue}
            onChange={e => setTopicValue(e.target.value)}
            onBlur={() => setSettingTopic(null)}
            onKeyDown={e => e.key === 'Escape' && setSettingTopic(null)}
          />
        </form>
      )
    }

    const count = unreadCounts[c.id] ?? 0
    const mentionCount = mentionCounts[c.id] ?? 0
    const muted = mutedChannelIds.has(c.id)

    return (
      <button
        type="button"
        key={c.id}
        className={`${styles.channel} ${c.id === activeChannelId ? styles.active : ''}`}
        onClick={() => onSelectChannel(c)}
        onContextMenu={e => handleContextMenu(e, c)}
        onPointerDown={e => startLongPress(e, c)}
        onPointerUp={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onPointerLeave={cancelLongPress}
      >
        <span className={styles.channelLabel}>
          # {c.name}
          {c.visibility === 'PRIVATE' && <span className={styles.privateMark} title="private channel">*</span>}
        </span>
        {mentionCount > 0 && (
          <span className={`${styles.unreadMention} ${muted ? styles.unreadMuted : ''}`}>
            [@{mentionCount}]
          </span>
        )}
        {count > 0 && mentionCount === 0 && (
          <span className={`${styles.unreadCount} ${muted ? styles.unreadMuted : ''}`}>
            [{count}]
          </span>
        )}
      </button>
    )
  }

  function renderVoiceChannel(c: Channel) {
    if (renaming?.id === c.id) {
      return (
        <div key={c.id} className={styles.voiceGroup}>
          <form onSubmit={submitRename} className={styles.renameForm}>
            <input
              ref={renameRef}
              autoFocus
              value={renameValue}
              onChange={e => setRenameValue(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
              onBlur={() => setRenaming(null)}
              onKeyDown={e => e.key === 'Escape' && setRenaming(null)}
            />
          </form>
        </div>
      )
    }

    const isActive = c.id === voiceChannelId
    const participants = voiceParticipants[c.id] ?? []
    const startTime = voiceChannelStartTimes[c.id]
    let liveTimer: string | null = null
    if (startTime !== undefined && participants.length > 0) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      const h = Math.floor(elapsed / 3600)
      const m = Math.floor((elapsed % 3600) / 60)
      const s = elapsed % 60
      const parts: string[] = []
      if (h > 0) parts.push(`${h}h`)
      if (h > 0 || m > 0) parts.push(`${m}m`)
      parts.push(`${s}s`)
      liveTimer = `[${parts.join(' ')}]`
    }

    return (
      <div key={c.id} className={styles.voiceGroup}>
        <button
          type="button"
          className={`${styles.channel} ${isActive ? styles.active : ''}`}
          onClick={() => { if (!isActive) onJoinVoice(c) }}
          onContextMenu={e => handleContextMenu(e, c)}
          onPointerDown={e => startLongPress(e, c)}
          onPointerUp={cancelLongPress}
          onPointerCancel={cancelLongPress}
          onPointerLeave={cancelLongPress}
        >
          ▸ {c.name}
          {c.visibility === 'PRIVATE' && <span className={styles.privateMark} title="private channel">*</span>}
          {voiceConnectingChannelId === c.id && <span className={styles.voiceConnecting}>connecting…</span>}
          {liveTimer && <span className={styles.voiceTimer}>{liveTimer}</span>}
        </button>
        {participants.map(uid => {
          const user = users.find(u => u.id === uid)
          const name = user?.displayName ?? uid
          const isTalking = uid === currentUserId ? isSpeaking : speakingUserIds.has(uid)
          const voiceState = uid === currentUserId
            ? { muted: isMuted, deafened: isDeafened }
            : (participantVoiceState[uid] ?? { muted: false, deafened: false })
          const badge = voiceState.deafened ? '[deaf]' : voiceState.muted ? '[muted]' : null
          const streaming = uid === currentUserId
            ? isScreenSharing
            : (participantVoiceState[uid]?.screenSharing ?? false)
          const cameraOn = uid === currentUserId
            ? isCameraOn
            : (participantVoiceState[uid]?.videoEnabled ?? false)
          if (uid === currentUserId) {
            return (
              <div key={uid} className={`${styles.voiceParticipant} ${isTalking ? styles.voiceParticipantSpeaking : ''}`}>
                <span className={styles.participantName}>{name}</span>
                {badge && <span className={styles.voiceStateBadge}>{badge}</span>}
                {streaming && (
                  <button type="button" className={styles.liveBadge} onClick={() => onWatchStream(uid, 'screen')}>[LIVE]</button>
                )}
                {cameraOn && (
                  <button type="button" className={styles.camBadge} onClick={() => onWatchStream(uid, 'camera')}>[CAM]</button>
                )}
              </div>
            )
          }
          return (
            <div
              key={uid}
              className={`${styles.voiceParticipant} ${styles.voiceParticipantInteractive} ${isTalking ? styles.voiceParticipantSpeaking : ''}`}
              onContextMenu={e => {
                e.preventDefault()
                e.stopPropagation()
                setParticipantVolumeMenu({ x: e.clientX, y: e.clientY, userId: uid, userName: name })
              }}
              onPointerDown={e => { participantLongPressTarget.current = { userId: uid, userName: name }; participantLongPress.onPointerDown(e) }}
              onPointerUp={participantLongPress.onPointerUp}
              onPointerCancel={participantLongPress.onPointerCancel}
              onPointerLeave={participantLongPress.onPointerLeave}
            >
              <span className={styles.participantName}>{name}</span>
              {badge && <span className={styles.voiceStateBadge}>{badge}</span>}
              {streaming && (
                <button type="button" className={styles.liveBadge} onClick={() => onWatchStream(uid, 'screen')}>[LIVE]</button>
              )}
              {cameraOn && (
                <button type="button" className={styles.camBadge} onClick={() => onWatchStream(uid, 'camera')}>[CAM]</button>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  function renderDMChannel(c: Channel) {
    const otherId = c.otherUserId
    const otherUser = users.find(u => u.id === otherId)
    const label = otherUser?.displayName ?? otherId ?? c.name
    const count = unreadCounts[c.id] ?? 0
    const mentionCount = mentionCounts[c.id] ?? 0
    const muted = mutedChannelIds.has(c.id)
    const status = getDMStatus(c)
    const dotClass = status === 'chatting' ? styles.dotChatting : status === 'online' ? styles.dotOnline : ''

    return (
      <button
        type="button"
        key={c.id}
        className={`${styles.dmChannel} ${c.id === activeChannelId ? styles.active : ''}`}
        onClick={() => onOpenDM(c)}
        onContextMenu={e => handleContextMenu(e, c)}
        onPointerDown={e => startLongPress(e, c)}
        onPointerUp={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onPointerLeave={cancelLongPress}
      >
        <span className={`${styles.dmDot} ${dotClass}`}>·</span>
        <span className={styles.dmLabel}>{label}</span>
        {mentionCount > 0 && (
          <span className={`${styles.unreadMention} ${muted ? styles.unreadMuted : ''}`}>
            [@{mentionCount}]
          </span>
        )}
        {count > 0 && mentionCount === 0 && (
          <span className={`${styles.unreadCount} ${muted ? styles.unreadMuted : ''}`}>
            [{count}]
          </span>
        )}
      </button>
    )
  }

  const voiceChannel = voiceChannelId ? channels.find(c => c.id === voiceChannelId) : null

  return (
    <>
      {isOpen && <div className={styles.backdrop} onClick={onClose} />}
      <nav ref={drawerRef} className={`${styles.root}${isOpen ? ` ${styles.open}` : ''}`}>
        <div className={styles.serverName}>
          GANDER
          {appVersion && <span className={styles.version}>v{appVersion}</span>}
          <NotificationInbox
            token={token}
            notifications={notifications}
            onMarkRead={onMarkNotificationRead}
            onMarkAllRead={onMarkAllNotificationsRead}
            onNotificationClick={onNotificationClick}
          />
          <button
            type="button"
            className={styles.quickSwitchBtn}
            onClick={onOpenQuickSwitcher}
            title="quick switcher (ctrl+k)"
            aria-label="open quick switcher"
          >[⌕]</button>
        </div>

        <div className={styles.channelList}>
          {/* Load feedback only matters when there is nothing to show — a
              background refresh shouldn't blank out an already-populated list */}
          {(visibleDMs.length === 0 && visibleText.length === 0 && visibleVoice.length === 0) && (
            channelsError ? (
              <div className={styles.loadState}>
                <span className={styles.loadStateError}>couldn't reach the server</span>
                <span className={styles.loadStateDetail}>{channelsError}</span>
                <button type="button" className={styles.loadStateBtn} onClick={onRetryChannels}>[retry]</button>
              </div>
            ) : channelsLoading ? (
              <div className={styles.loadState}>loading channels…</div>
            ) : (
              <div className={styles.loadState}>
                <span>no channels yet</span>
                <button type="button" className={styles.loadStateBtn} onClick={onBrowseChannels}>[browse channels]</button>
              </div>
            )
          )}
          {(visibleDMs.length > 0 || visibleText.length > 0 || visibleVoice.length > 0) && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span>direct messages</span>
              </div>
              {visibleDMs.length === 0 && (
                <div className={styles.sectionHint}>no conversations yet — click a user to say hi</div>
              )}
              {visibleDMs.map(c => renderDMChannel(c))}
            </div>
          )}

          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span>text channels</span>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button type="button" className={styles.addBtn} onClick={() => setCreating('TEXT')} title="create channel" aria-label="create text channel">[new]</button>
                <button type="button" className={styles.addBtn} onClick={onBrowseChannels} title="browse channels" aria-label="browse channels">[⊕]</button>
                <button type="button" className={styles.addBtn} onClick={() => setIndexOpen(true)} title="show/hide" aria-label="show or hide channels">[+]</button>
              </div>
            </div>
            {visibleText.map(c => renderTextChannel(c))}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span>voice channels</span>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button type="button" className={styles.addBtn} onClick={() => setCreating('VOICE')} title="create channel" aria-label="create voice channel">[new]</button>
                <button type="button" className={styles.addBtn} onClick={() => setIndexOpen(true)} title="show/hide" aria-label="show or hide channels">[+]</button>
              </div>
            </div>
            {visibleVoice.map(c => renderVoiceChannel(c))}
          </div>

          {(visibleUtilities.length > 0 || isMod(currentUserRole)) && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span>utilities</span>
                <button type="button" className={styles.addBtn} onClick={() => setIndexOpen(true)}>[+]</button>
              </div>
              {visibleUtilities.map(u => (
                <button
                  key={u.id}
                  type="button"
                  className={`${styles.channel} ${activeUtilityId === u.id ? styles.active : ''}`}
                  onClick={() => onOpenUtility(u.id)}
                  onContextMenu={e => { e.preventDefault(); setUtilityContext({ id: u.id, label: u.label, x: e.clientX, y: e.clientY }) }}
                >
                  <span className={styles.channelLabel}>{u.label}</span>
                </button>
              ))}
              {isMod(currentUserRole) && (
                <button
                  type="button"
                  className={`${styles.channel} ${activeUtilityId === 'admin' ? styles.active : ''}`}
                  onClick={() => onOpenUtility('admin')}
                >
                  <span className={styles.channelLabel}>[admin panel]</span>
                </button>
              )}
            </div>
          )}
        </div>

        {voiceChannel && (
          <VoiceControls
            channelName={voiceChannel.name}
            voiceStats={voiceStats}
            isCameraOn={isCameraOn}
            isScreenSharing={isScreenSharing}
            onToggleCamera={onToggleCamera}
            onToggleScreenShare={onToggleScreenShare}
            onLeave={onLeaveVoice}
            pttEnabled={pttEnabled}
            onPttDown={onPttDown}
            onPttUp={onPttUp}
          />
        )}

        <div className={styles.userBar}>
          <span className={styles.username}>{displayName}</span>
          <div className={styles.userControls}>
            <button
              type="button"
              className={`${styles.userBtn} ${isMuted ? styles.userBtnActive : isSpeaking ? styles.userBtnSpeaking : ''}`}
              onClick={onToggleMute}
              title={isMuted ? 'unmute mic' : 'mute mic'}
            >
              {isMuted ? '[muted]' : '[mic]'}
            </button>
            <button
              type="button"
              className={`${styles.userBtn} ${isDeafened ? styles.userBtnActive : isReceiving ? styles.userBtnReceiving : ''}`}
              onClick={onToggleDeafen}
              title={isDeafened ? 'undeafen' : 'deafen'}
            >
              {isDeafened ? '[deaf]' : '[hear]'}
            </button>
            <button
              type="button"
              className={styles.userBtn}
              onClick={onOpenSettings}
              title="settings"
            >
              [⚙]
            </button>
          </div>
        </div>
      </nav>

      {context && (
        <ContextMenu
          x={context.x}
          y={context.y}
          items={contextItems(context.channel)}
          onClose={() => setContext(null)}
        />
      )}

      {utilityContext && (
        <ContextMenu
          x={utilityContext.x}
          y={utilityContext.y}
          items={[
            { label: 'hide', action: () => onToggleUtilityVisibility(utilityContext.id) },
            { label: 'copy link', action: () => void navigator.clipboard.writeText(`#${utilityContext.id}`) },
          ]}
          onClose={() => setUtilityContext(null)}
        />
      )}

      {participantVolumeMenu && (
        <ParticipantVolumeMenu
          x={participantVolumeMenu.x}
          y={participantVolumeMenu.y}
          userId={participantVolumeMenu.userId}
          userName={participantVolumeMenu.userName}
          volume={participantVolumes[participantVolumeMenu.userId] ?? 1.0}
          onSetVolume={onSetParticipantVolume}
          onClose={() => setParticipantVolumeMenu(null)}
        />
      )}

      {indexOpen && (
        <ChannelIndexModal
          channels={channels}
          hiddenChannelIds={hiddenChannelIds}
          currentUserId={currentUserId}
          onToggleVisibility={onToggleChannelVisibility}
          onDeleteChannel={(id) => { onDeleteChannel(id); setIndexOpen(false) }}
          onClose={() => setIndexOpen(false)}
          hiddenUtilityIds={hiddenUtilityIds}
          onToggleUtilityVisibility={onToggleUtilityVisibility}
        />
      )}

      {deleting && (
        <ConfirmDeleteModal
          channelName={deleting.name}
          onConfirm={() => { onDeleteChannel(deleting.id); setDeleting(null) }}
          onClose={() => setDeleting(null)}
        />
      )}

      {creating && (
        <CreateChannelModal
          initialType={creating}
          onConfirm={(name, type) => { onCreateChannel(name, type); setCreating(null) }}
          onClose={() => setCreating(null)}
        />
      )}
    </>
  )
}
