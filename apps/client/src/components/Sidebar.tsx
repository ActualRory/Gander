import { useEffect, useRef, useState } from 'react'
import type { Channel, User } from '@gander/shared'
import ContextMenu, { type ContextMenuItem } from './ContextMenu.tsx'
import ChannelIndexModal from './ChannelIndexModal.tsx'
import ConfirmDeleteModal from './ConfirmDeleteModal.tsx'
import VoiceControls, { type VoiceStats } from './VoiceControls.tsx'
import ParticipantVolumeMenu from './ParticipantVolumeMenu.tsx'
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
  onClose: () => void
  hasUpdate: boolean
  onShowUpdate: () => void
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

export default function Sidebar({ channels, dmChannels, activeChannelId, currentUserId, hiddenChannelIds, unreadCounts, mentionCounts, mutedChannelIds, users, onlineUserIds, voiceChannelId, voiceParticipants, voiceChannelStartTimes, isMuted, isDeafened, isSpeaking, isReceiving, speakingUserIds, voiceStats, onSelectChannel, onCreateChannel, onRenameChannel, onDeleteChannel, onHideChannel, onToggleChannelVisibility, onMarkRead, onToggleMuted, onJoinVoice, onLeaveVoice, onToggleMute, onToggleDeafen, isCameraOn, isScreenSharing, onToggleCamera, onToggleScreenShare, onOpenSettings, onOpenDM, onHideDM, onSetTopic, displayName, participantVolumes, onSetParticipantVolume, participantVoiceState, onWatchStream, isOpen, onClose, hasUpdate, onShowUpdate }: Props) {
  const [indexOpen, setIndexOpen] = useState(false)
  const [context, setContext] = useState<ContextState | null>(null)
  const [participantVolumeMenu, setParticipantVolumeMenu] = useState<ParticipantVolumeState | null>(null)
  const [renaming, setRenaming] = useState<Channel | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [settingTopic, setSettingTopic] = useState<Channel | null>(null)
  const [topicValue, setTopicValue] = useState('')
  const [deleting, setDeleting] = useState<Channel | null>(null)
  const renameRef = useRef<HTMLInputElement>(null)
  const topicRef = useRef<HTMLInputElement>(null)
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const visibleText = channels.filter(c => c.type === 'TEXT' && !hiddenChannelIds.has(c.id))
  const visibleVoice = channels.filter(c => c.type === 'VOICE' && !hiddenChannelIds.has(c.id))
  const visibleDMs = dmChannels.filter(c => !hiddenChannelIds.has(c.id))

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
    if (channel.creatorId === currentUserId) {
      items.push({ label: 'rename', action: () => startRename(channel) })
      if (channel.type === 'TEXT') {
        items.push({ label: 'set topic', action: () => { setSettingTopic(channel); setTopicValue(channel.topic ?? '') } })
      }
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
        <span className={styles.channelLabel}># {c.name}</span>
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
      <nav className={`${styles.root}${isOpen ? ` ${styles.open}` : ''}`}>
        <div className={styles.serverName}>
          GANDER
          {hasUpdate && (
            <button
              type="button"
              className={styles.updateBtn}
              onClick={onShowUpdate}
              title="update available"
            >
              [!]
            </button>
          )}
        </div>

        <div className={styles.channelList}>
          {visibleDMs.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span>direct messages</span>
              </div>
              {visibleDMs.map(c => renderDMChannel(c))}
            </div>
          )}

          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span>text channels</span>
              <button type="button" className={styles.addBtn} onClick={() => setIndexOpen(true)}>[+]</button>
            </div>
            {visibleText.map(c => renderTextChannel(c))}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span>voice channels</span>
              <button type="button" className={styles.addBtn} onClick={() => setIndexOpen(true)}>[+]</button>
            </div>
            {visibleVoice.map(c => renderVoiceChannel(c))}
          </div>
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
              {isDeafened ? '[h]' : '[hear]'}
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
          onCreateChannel={(name, type) => { onCreateChannel(name, type) }}
          onDeleteChannel={(id) => { onDeleteChannel(id); setIndexOpen(false) }}
          onClose={() => setIndexOpen(false)}
        />
      )}

      {deleting && (
        <ConfirmDeleteModal
          channelName={deleting.name}
          onConfirm={() => { onDeleteChannel(deleting.id); setDeleting(null) }}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  )
}
