import { createPortal } from 'react-dom'
import { useRef, useState } from 'react'
import { api } from '../lib/api.ts'
import type { Channel } from '@gander/shared'
import styles from './LinkPreviews.module.css'

const UTILITY_NAMES = new Set(['library', 'file-manager', 'gandle'])

interface Props {
  channel: Channel
  token: string
  onNavigate: () => void
  participantCount?: number
}

export default function ChannelLinkChip({ channel, token, onNavigate, participantCount }: Props) {
  const [tooltip, setTooltip] = useState<{ rect: DOMRect; messageCount?: number } | null>(null)
  const fetchedRef = useRef(false)

  async function handleMouseEnter(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setTooltip({ rect })
    if (!fetchedRef.current && channel.type === 'TEXT') {
      fetchedRef.current = true
      try {
        const preview = await api.getChannelPreview(token, channel.id)
        setTooltip(prev => prev ? { ...prev, messageCount: preview.messageCount } : null)
      } catch {
        fetchedRef.current = false
      }
    }
  }

  const isUtility = UTILITY_NAMES.has(channel.name) && channel.type !== 'TEXT' && channel.type !== 'VOICE'
  const prefix = channel.type === 'VOICE' ? '▸ ' : '# '
  const label = isUtility ? channel.name : `${prefix}${channel.name}`

  return (
    <>
      <button
        type="button"
        className={styles.channelLinkChip}
        onClick={onNavigate}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setTooltip(null)}
      >
        {label}
      </button>
      {tooltip && createPortal(
        <div
          className={styles.channelTooltip}
          style={{
            left: tooltip.rect.left,
            top: tooltip.rect.top - 8,
            transform: 'translateY(-100%)',
          }}
        >
          <div className={styles.channelTooltipName}>{label}</div>
          <div className={styles.channelTooltipMeta}>
            {channel.type === 'VOICE' && participantCount !== undefined && (
              <span>{participantCount} in voice</span>
            )}
            {channel.type === 'TEXT' && channel.topic && <span>{channel.topic}</span>}
            {channel.type === 'TEXT' && tooltip.messageCount !== undefined && (
              <span>{tooltip.messageCount.toLocaleString()} messages</span>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
