import styles from './VoiceControls.module.css'

interface Props {
  channelName: string
  isMuted: boolean
  isDeafened: boolean
  isSpeaking: boolean
  isReceiving: boolean
  onToggleMute: () => void
  onToggleDeafen: () => void
  onOpenSettings: () => void
  onLeave: () => void
}

export default function VoiceControls({ channelName, isMuted, isDeafened, isSpeaking, isReceiving, onToggleMute, onToggleDeafen, onOpenSettings, onLeave }: Props) {
  return (
    <div className={styles.root}>
      <div className={styles.status}>
        <span className={styles.label}>voice connected</span>
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
  )
}
