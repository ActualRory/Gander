import { useEffect, useRef, useState } from 'react'
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
  pttEnabled: boolean
  onPttDown: () => void
  onPttUp: () => void
}

export default function VoiceControls({ channelName, voiceStats, isCameraOn, isScreenSharing, onToggleCamera, onToggleScreenShare, onLeave, pttEnabled, onPttDown, onPttUp }: Props) {
  const iconRef = useRef<HTMLSpanElement>(null)
  const [tooltipAnchor, setTooltipAnchor] = useState<DOMRect | null>(null)

  // Tap-away closes the tap-toggled stats tooltip (hover close handles desktop)
  useEffect(() => {
    if (!tooltipAnchor) return
    function onDocPointerDown(e: PointerEvent) {
      if (iconRef.current && !iconRef.current.contains(e.target as Node)) setTooltipAnchor(null)
    }
    window.addEventListener('pointerdown', onDocPointerDown)
    return () => window.removeEventListener('pointerdown', onDocPointerDown)
  }, [tooltipAnchor])

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
                onClick={() => setTooltipAnchor(a => a ? null : (iconRef.current?.getBoundingClientRect() ?? null))}
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
        {pttEnabled && (
          <button
            type="button"
            className={styles.pttBar}
            onPointerDown={e => { e.preventDefault(); onPttDown() }}
            onPointerUp={onPttUp}
            onPointerCancel={onPttUp}
            onPointerLeave={onPttUp}
            onContextMenu={e => e.preventDefault()}
          >
            [hold to talk]
          </button>
        )}
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
