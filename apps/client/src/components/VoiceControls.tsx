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
  voiceStats: VoiceStats | null
  isCameraOn: boolean
  isScreenSharing: boolean
  onToggleCamera: () => void
  onToggleScreenShare: () => void
  onLeave: () => void
}

export default function VoiceControls({ channelName, voiceStats, isCameraOn, isScreenSharing, onToggleCamera, onToggleScreenShare, onLeave }: Props) {
  const iconRef = useRef<HTMLSpanElement>(null)
  const [tooltipAnchor, setTooltipAnchor] = useState<DOMRect | null>(null)

  return (
    <>
      <div className={styles.root}>
        <div className={styles.header}>
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
          <button
            type="button"
            className={styles.leaveBtn}
            onClick={onLeave}
            title="disconnect from voice"
          >
            [x]
          </button>
        </div>
        <span className={styles.channel}>▸ {channelName}</span>
        <div className={styles.controls}>
          <button
            type="button"
            className={`${styles.btn} ${isCameraOn ? styles.btnActive : ''}`}
            onClick={onToggleCamera}
            title={isCameraOn ? 'stop camera' : 'start camera'}
          >
            [cam]
          </button>
          <button
            type="button"
            className={`${styles.btn} ${isScreenSharing ? styles.btnActive : ''}`}
            onClick={onToggleScreenShare}
            title={isScreenSharing ? 'stop screen share' : 'share screen'}
          >
            [scr]
          </button>
        </div>
      </div>
      {tooltipAnchor && voiceStats && createPortal(
        <div
          className={styles.statsTooltip}
          style={{ left: tooltipAnchor.left, bottom: window.innerHeight - tooltipAnchor.top + 6 }}
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
