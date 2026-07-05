import { useEffect } from 'react'
import { useFocusTrap } from '../lib/useFocusTrap.ts'
import styles from './ErrorModal.module.css'

interface Props {
  message: string
  onClose: () => void
}

export default function ErrorModal({ message, onClose }: Props) {
  const trapRef = useFocusTrap<HTMLDivElement>()
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal} ref={trapRef} role="alertdialog" aria-modal="true" aria-label="error">
        <div className={styles.header}>
          <span className={styles.title}>error</span>
          <button type="button" className={styles.closeBtn} onClick={onClose}>[x]</button>
        </div>
        <pre className={styles.message}>{message}</pre>
        <div className={styles.footer}>
          <button type="button" onClick={onClose}>close</button>
        </div>
      </div>
    </div>
  )
}
