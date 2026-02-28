import styles from './VoiceControls.module.css'

interface Props {
  channelName: string
  isMuted: boolean
  isDeafened: boolean
  onToggleMute: () => void
  onToggleDeafen: () => void
  onLeave: () => void
}

export default function VoiceControls({ channelName, isMuted, isDeafened, onToggleMute, onToggleDeafen, onLeave }: Props) {
  return (
    <div className={styles.root}>
      <div className={styles.status}>
        <span className={styles.label}>voice connected</span>
        <span className={styles.channel}>▸ {channelName}</span>
      </div>
      <div className={styles.controls}>
        <button
          type="button"
          className={`${styles.btn} ${isMuted ? styles.btnActive : ''}`}
          onClick={onToggleMute}
          title={isMuted ? 'unmute mic' : 'mute mic'}
        >
          {isMuted ? '[muted]' : '[mic]'}
        </button>
        <button
          type="button"
          className={`${styles.btn} ${isDeafened ? styles.btnActive : ''}`}
          onClick={onToggleDeafen}
          title={isDeafened ? 'undeafen' : 'deafen'}
        >
          {isDeafened ? '[deaf]' : '[hear]'}
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
  )
}
