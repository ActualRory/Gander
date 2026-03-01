import { useRef, useState } from 'react'
import type { Channel, User } from '@gander/shared'
import ContextMenu, { type ContextMenuItem } from './ContextMenu.tsx'
import ChannelIndexModal from './ChannelIndexModal.tsx'
import ConfirmDeleteModal from './ConfirmDeleteModal.tsx'
import VoiceControls from './VoiceControls.tsx'
import styles from './Sidebar.module.css'

interface Props {
  channels: Channel[]
  activeChannelId: string | null
  currentUserId: string
  hiddenChannelIds: Set<string>
  users: User[]
  voiceChannelId: string | null
  voiceParticipants: Record<string, string[]>
  isMuted: boolean
  isDeafened: boolean
  isSpeaking: boolean
  isReceiving: boolean
  onSelectChannel: (channel: Channel) => void
  onCreateChannel: (name: string, type: 'TEXT' | 'VOICE') => void
  onRenameChannel: (channelId: string, name: string) => void
  onDeleteChannel: (channelId: string) => void
  onHideChannel: (channelId: string) => void
  onToggleChannelVisibility: (channelId: string) => void
  onJoinVoice: (channel: Channel) => void
  onLeaveVoice: () => void
  onToggleMute: () => void
  onToggleDeafen: () => void
  onOpenVoiceSettings: () => void
  displayName: string
  onLogout: () => void
}

interface ContextState {
  x: number
  y: number
  channel: Channel
}

export default function Sidebar({ channels, activeChannelId, currentUserId, hiddenChannelIds, users, voiceChannelId, voiceParticipants, isMuted, isDeafened, isSpeaking, isReceiving, onSelectChannel, onCreateChannel, onRenameChannel, onDeleteChannel, onHideChannel, onToggleChannelVisibility, onJoinVoice, onLeaveVoice, onToggleMute, onToggleDeafen, onOpenVoiceSettings, displayName, onLogout }: Props) {
  const [indexOpen, setIndexOpen] = useState(false)
  const [context, setContext] = useState<ContextState | null>(null)
  const [renaming, setRenaming] = useState<Channel | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleting, setDeleting] = useState<Channel | null>(null)
  const renameRef = useRef<HTMLInputElement>(null)

  const visibleText = channels.filter(c => c.type === 'TEXT' && !hiddenChannelIds.has(c.id))
  const visibleVoice = channels.filter(c => c.type === 'VOICE' && !hiddenChannelIds.has(c.id))

  function handleContextMenu(e: React.MouseEvent, channel: Channel) {
    e.preventDefault()
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

  function contextItems(channel: Channel): ContextMenuItem[] {
    const items: ContextMenuItem[] = [
      { label: 'hide', action: () => onHideChannel(channel.id) },
    ]
    if (channel.creatorId === currentUserId) {
      items.push({ label: 'rename', action: () => startRename(channel) })
      items.push({ label: 'delete', danger: true, action: () => setDeleting(channel) })
    }
    return items
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

    return (
      <button
        type="button"
        key={c.id}
        className={`${styles.channel} ${c.id === activeChannelId ? styles.active : ''}`}
        onClick={() => onSelectChannel(c)}
        onContextMenu={e => handleContextMenu(e, c)}
      >
        # {c.name}
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

    return (
      <div key={c.id} className={styles.voiceGroup}>
        <button
          type="button"
          className={`${styles.channel} ${isActive ? styles.active : ''}`}
          onClick={() => { if (!isActive) onJoinVoice(c) }}
          onContextMenu={e => handleContextMenu(e, c)}
        >
          ▸ {c.name}
        </button>
        {participants.map(uid => {
          const user = users.find(u => u.id === uid)
          return (
            <div key={uid} className={styles.voiceParticipant}>
              {user?.displayName ?? uid}
            </div>
          )
        })}
      </div>
    )
  }

  const voiceChannel = voiceChannelId ? channels.find(c => c.id === voiceChannelId) : null

  return (
    <>
      <nav className={styles.root}>
        <div className={styles.serverName}>GANDER</div>

        <div className={styles.channelList}>
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
            isMuted={isMuted}
            isDeafened={isDeafened}
            isSpeaking={isSpeaking}
            isReceiving={isReceiving}
            onToggleMute={onToggleMute}
            onToggleDeafen={onToggleDeafen}
            onOpenSettings={onOpenVoiceSettings}
            onLeave={onLeaveVoice}
          />
        )}

        <div className={styles.userBar}>
          <span className={styles.username}>{displayName}</span>
          <button type="button" className={styles.logoutBtn} onClick={onLogout}>logout</button>
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
