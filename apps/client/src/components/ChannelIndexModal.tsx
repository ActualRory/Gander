import { useEffect, useState } from 'react'
import type { Channel } from '@gander/shared'
import ContextMenu, { type ContextMenuItem } from './ContextMenu.tsx'
import CreateChannelModal from './CreateChannelModal.tsx'
import styles from './ChannelIndexModal.module.css'

interface ContextState {
  x: number
  y: number
  channel: Channel
}

interface Props {
  channels: Channel[]
  hiddenChannelIds: Set<string>
  currentUserId: string
  onToggleVisibility: (channelId: string) => void
  onCreateChannel: (name: string, type: 'TEXT' | 'VOICE') => void
  onDeleteChannel: (channelId: string) => void
  onClose: () => void
}

export default function ChannelIndexModal({
  channels,
  hiddenChannelIds,
  currentUserId,
  onToggleVisibility,
  onCreateChannel,
  onDeleteChannel,
  onClose,
}: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [context, setContext] = useState<ContextState | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !createOpen) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, createOpen])

  function handleContextMenu(e: React.MouseEvent, channel: Channel) {
    e.preventDefault()
    e.stopPropagation()
    if (channel.creatorId !== currentUserId) return
    setContext({ x: e.clientX, y: e.clientY, channel })
  }

  function contextItems(channel: Channel): ContextMenuItem[] {
    return [
      { label: 'delete', danger: true, action: () => onDeleteChannel(channel.id) },
    ]
  }

  const text = channels.filter(c => c.type === 'TEXT')
  const voice = channels.filter(c => c.type === 'VOICE')

  function renderChannel(c: Channel, prefix: string) {
    const visible = !hiddenChannelIds.has(c.id)
    return (
      <button
        key={c.id}
        type="button"
        className={`${styles.channel} ${visible ? styles.channelVisible : styles.channelHidden}`}
        onClick={() => onToggleVisibility(c.id)}
        onContextMenu={e => handleContextMenu(e, c)}
      >
        {prefix} {c.name}
      </button>
    )
  }

  return (
    <>
      <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
        <div className={styles.modal}>
          <div className={styles.header}>
            <span className={styles.title}>all channels</span>
            <button type="button" className={styles.newBtn} onClick={() => setCreateOpen(true)}>
              [new channel]
            </button>
          </div>
          <div className={styles.hint}>click to show / hide in sidebar</div>
          <div className={styles.channelList}>
            {text.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionLabel}>text channels</div>
                {text.map(c => renderChannel(c, '#'))}
              </div>
            )}
            {voice.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionLabel}>voice channels</div>
                {voice.map(c => renderChannel(c, '▸'))}
              </div>
            )}
            {channels.length === 0 && (
              <div className={styles.empty}>no channels yet</div>
            )}
          </div>
        </div>
      </div>

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
    </>
  )
}
