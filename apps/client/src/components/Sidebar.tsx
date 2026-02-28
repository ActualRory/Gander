import { useRef, useState } from 'react'
import type { Channel } from '@gander/shared'
import ContextMenu, { type ContextMenuItem } from './ContextMenu.tsx'
import CreateChannelModal from './CreateChannelModal.tsx'
import ConfirmDeleteModal from './ConfirmDeleteModal.tsx'
import styles from './Sidebar.module.css'

interface Props {
  channels: Channel[]
  activeChannelId: string | null
  onSelectChannel: (channel: Channel) => void
  onCreateChannel: (name: string, type: 'TEXT' | 'VOICE') => void
  onRenameChannel: (channelId: string, name: string) => void
  onDeleteChannel: (channelId: string) => void
  displayName: string
  onLogout: () => void
}

interface ContextState {
  x: number
  y: number
  channel: Channel
}

export default function Sidebar({ channels, activeChannelId, onSelectChannel, onCreateChannel, onRenameChannel, onDeleteChannel, displayName, onLogout }: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [context, setContext] = useState<ContextState | null>(null)
  const [renaming, setRenaming] = useState<Channel | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleting, setDeleting] = useState<Channel | null>(null)
  const renameRef = useRef<HTMLInputElement>(null)

  const text = channels.filter(c => c.type === 'TEXT')
  const voice = channels.filter(c => c.type === 'VOICE')

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
    return [
      { label: 'rename', action: () => startRename(channel) },
      { label: 'delete', danger: true, action: () => setDeleting(channel) },
    ]
  }

  function renderChannel(c: Channel, prefix: string) {
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
        {prefix} {c.name}
      </button>
    )
  }

  return (
    <>
      <nav className={styles.root}>
        <div className={styles.serverName}>GANDER</div>

        <div className={styles.channelList}>
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span>text channels</span>
              <button type="button" className={styles.addBtn} onClick={() => setCreateOpen(true)}>[+]</button>
            </div>
            {text.map(c => renderChannel(c, '#'))}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span>voice channels</span>
              <button type="button" className={styles.addBtn} onClick={() => setCreateOpen(true)}>[+]</button>
            </div>
            {voice.map(c => renderChannel(c, '▸'))}
          </div>
        </div>

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

      {createOpen && (
        <CreateChannelModal
          onConfirm={(name, type) => { onCreateChannel(name, type); setCreateOpen(false) }}
          onClose={() => setCreateOpen(false)}
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
