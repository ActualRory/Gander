import { useEffect, useState } from 'react'
import styles from './BootOverlay.module.css'

const CLEAR_START_MS = 4000
const DONE_MS = 5500

interface Props {
  onDone: () => void
}

export default function BootOverlay({ onDone }: Props) {
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    const t1 = setTimeout(() => setClearing(true), CLEAR_START_MS)
    const t2 = setTimeout(onDone, DONE_MS)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [onDone])

  return (
    <div className={`${styles.overlay} ${clearing ? styles.clearing : ''}`}>
      <div className={styles.scanlines} />
    </div>
  )
}
