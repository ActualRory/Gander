import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { invoke } from '@tauri-apps/api/core'
import styles from './ScreenPickerModal.module.css'

export interface CaptureSource {
  id: string
  name: string
  sourceType: 'window' | 'screen'
  appName: string
}

interface Props {
  onSelect: (source: CaptureSource) => void
  onCancel: () => void
}

export default function ScreenPickerModal({ onSelect, onCancel }: Props) {
  const [sources, setSources] = useState<CaptureSource[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    invoke<CaptureSource[]>('get_capture_sources')
      .then(setSources)
      .catch(() => setSources([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const screens = sources.filter(s => s.sourceType === 'screen')
  const windows = sources.filter(s => s.sourceType === 'window')

  // Group windows by appName
  const groups: { appName: string; sources: CaptureSource[] }[] = []
  for (const source of windows) {
    const group = groups.find(g => g.appName === source.appName)
    if (group) {
      group.sources.push(source)
    } else {
      groups.push({ appName: source.appName, sources: [source] })
    }
  }
  groups.sort((a, b) => a.appName.localeCompare(b.appName))

  return createPortal(
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>share screen</span>
          <button type="button" className={styles.closeBtn} onClick={onCancel}>[x]</button>
        </div>
        {loading ? (
          <div className={styles.loading}>loading sources...</div>
        ) : (
          <div className={styles.content}>
            {screens.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionLabel}>screens</div>
                <div className={styles.tiles}>
                  {screens.map(s => (
                    <button key={s.id} type="button" className={styles.tile} onClick={() => onSelect(s)}>
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {groups.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionLabel}>applications</div>
                <div className={styles.groups}>
                  {groups.map(group => (
                    <div key={group.appName} className={styles.group}>
                      <div className={styles.groupLabel}>{group.appName || 'unknown'}</div>
                      <div className={styles.tiles}>
                        {group.sources.map(s => (
                          <button key={s.id} type="button" className={styles.tile} onClick={() => onSelect(s)}>
                            {s.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {screens.length === 0 && groups.length === 0 && (
              <div className={styles.loading}>no sources found</div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
