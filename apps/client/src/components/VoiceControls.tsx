import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './VoiceControls.module.css'

export interface VoiceStats {
  quality: 'excellent' | 'good' | 'poor' | 'unknown'
  ping: number | null
  jitter: number | null
  packetsLost: number | null
}

interface Props {
  channelName: string
  isMuted: boolean
  isDeafened: boolean
  isSpeaking: boolean
  isReceiving: boolean
  voiceStats: VoiceStats | null
  onToggleMute: () => void
  onToggleDeafen: () => void
  onOpenSettings: () => void
  onLeave: () => void
}

export default function VoiceControls({ channelName, isMuted, isDeafened, isSpeaking, isReceiving, voiceStats, onToggleMute, onToggleDeafen, onOpenSettings, onLeave }: Props) {
  const iconRef = useRef<HTMLSpanElement>(null)
  const [tooltipAnchor, setTooltipAnchor] = useState<DOMRect | null>(null)

  const anchor = tooltipAnchor

  return (
    <>
      <div className={styles.root}>
        <div className={styles.status}>
          <div className={styles.labelRow}>
            <span className={styles.label}>voice connected</span>
            {voiceStats && (
              <span
                ref={iconRef}
                className={`${styles.statsIcon} ${styles[`quality_${voiceStats.quality}`]}`}
                onMouseEnter={() => setTooltipAnchor(iconRef.current?.getBoundingClientRect() ?? null)}
                onMouseLeave={() => setTooltipAnchor(null)}
              >
                [~]
              </span>
            )}
          </div>
          <span className={styles.channel}>▸ {channelName}</span>
        </div>
        <div className={styles.controls}>
          <button
            type="button"
            className={`${styles.btn} ${isMuted ? styles.btnActive : isSpeaking ? styles.speaking : ''}`}
            onClick={onToggleMute}
            title={isMuted ? 'unmute mic' : 'mute mic'}
          >
            {isMuted ? '[muted]' : '[mic]'}
          </button>
          <button
            type="button"
            className={`${styles.btn} ${isDeafened ? styles.btnActive : isReceiving ? styles.receiving : ''}`}
            onClick={onToggleDeafen}
            title={isDeafened ? 'undeafen' : 'deafen'}
          >
            {isDeafened ? '[deaf]' : '[hear]'}
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.settingsBtn}`}
            onClick={onOpenSettings}
            title="voice settings"
          >
            [⚙]
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.leaveBtn}`}
            onClick={onLeave}
            title="disconnect from voice"
          >
            [x]
          </button>
        </div>
      </div>
      {anchor && voiceStats && createPortal(
        <div
          className={styles.statsTooltip}
          style={{ left: anchor.left, bottom: window.innerHeight - anchor.top + 6 }}
        >
          <div>quality:  {voiceStats.quality}</div>
          {voiceStats.ping != null && <div>ping:     {voiceStats.ping}ms</div>}
          {voiceStats.jitter != null && <div>jitter:   {voiceStats.jitter}ms</div>}
          {voiceStats.packetsLost != null && <div>loss:     {voiceStats.packetsLost}%</div>}
        </div>,
        document.body
      )}
    </>
  )
}
