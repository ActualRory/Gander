import { useEffect, useState } from 'react'
import styles from './BootOverlay.module.css'

const CLEAR_START_MS = 6500
const DONE_MS = 7300

interface Props {
  onDone: () => void
  onClearing?: () => void
}

export default function BootOverlay({ onDone, onClearing }: Props) {
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    const t1 = setTimeout(() => {
      setClearing(true)
      onClearing?.()
    }, CLEAR_START_MS)
    const t2 = setTimeout(onDone, DONE_MS)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [onDone, onClearing])

  return (
    <div className={`${styles.overlay} ${clearing ? styles.clearing : ''}`}>
      <div className={styles.scanlines} />
    </div>
  )
}
