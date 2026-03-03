import type { UpdaterState } from '../lib/useAppUpdater.ts'
import styles from './UpdateBanner.module.css'

interface Props {
  state: UpdaterState
  onInstall: () => void
  onDismiss: () => void
}

export default function UpdateBanner({ state, onInstall, onDismiss }: Props) {
  if (state.phase === 'idle') return null

  const isWorking = state.phase === 'downloading' || state.phase === 'ready'

  function renderContent() {
    if (state.phase === 'available') {
      return (
        <>
          <span className={styles.message}>
            update available: <span className={styles.version}>v{state.version}</span>
          </span>
          <div className={styles.actions}>
            <button type="button" className={styles.installBtn} onClick={onInstall}>
              [update &amp; restart]
            </button>
            <button type="button" className={styles.dismissBtn} onClick={onDismiss}>
              [x]
            </button>
          </div>
        </>
      )
    }

    if (state.phase === 'downloading') {
      const pct = state.progress
      return (
        <>
          <span className={styles.message}>
            {pct !== null ? `downloading... ${pct}%` : 'downloading...'}
          </span>
          {pct !== null && (
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${pct}%` }} />
            </div>
          )}
        </>
      )
    }

    if (state.phase === 'ready') {
      return <span className={styles.message}>installing... restarting shortly</span>
    }

    if (state.phase === 'error') {
      return (
        <>
          <span className={styles.messageError}>update failed: {state.message}</span>
          <button type="button" className={styles.dismissBtn} onClick={onDismiss}>
            [x]
          </button>
        </>
      )
    }

    return null
  }

  return (
    <div className={`${styles.banner} ${isWorking ? styles.bannerActive : ''}`}>
      {renderContent()}
    </div>
  )
}
