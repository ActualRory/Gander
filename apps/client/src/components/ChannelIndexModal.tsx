import { useEffect, useState } from 'react'
import type { Channel } from '@gander/shared'
import ContextMenu, { type ContextMenuItem } from './ContextMenu.tsx'
import { useFocusTrap } from '../lib/useFocusTrap.ts'
import styles from './ChannelIndexModal.module.css'

const UTILITIES = [
  { id: 'library', label: 'the library' },
  { id: 'gandle', label: 'gandle' },
]

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
  onDeleteChannel: (channelId: string) => void
  onClose: () => void
  hiddenUtilityIds: Set<string>
  onToggleUtilityVisibility: (id: string) => void
}

export default function ChannelIndexModal({
  channels,
  hiddenChannelIds,
  currentUserId,
  onToggleVisibility,
  onDeleteChannel,
  onClose,
  hiddenUtilityIds,
  onToggleUtilityVisibility,
}: Props) {
  const [context, setContext] = useState<ContextState | null>(null)
  const trapRef = useFocusTrap<HTMLDivElement>()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
        <div className={styles.modal} ref={trapRef} role="dialog" aria-modal="true" aria-label="show or hide channels">
          <div className={styles.header}>
            <span className={styles.title}>show / hide channels</span>
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
            <div className={styles.section}>
              <div className={styles.sectionLabel}>utilities</div>
              {UTILITIES.map(u => {
                const visible = !hiddenUtilityIds.has(u.id)
                return (
                  <button
                    key={u.id}
                    type="button"
                    className={`${styles.channel} ${visible ? styles.channelVisible : styles.channelHidden}`}
                    onClick={() => onToggleUtilityVisibility(u.id)}
                  >
                    {u.label}
                  </button>
                )
              })}
            </div>
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

    </>
  )
}
