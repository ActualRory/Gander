import { useEffect, useState } from 'react'
import styles from './ConfirmDeleteModal.module.css'

interface Props {
  channelName: string
  onConfirm: () => void
  onClose: () => void
}

export default function ConfirmDeleteModal({ channelName, onConfirm, onClose }: Props) {
  const [value, setValue] = useState('')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (value !== channelName) return
    onConfirm()
  }

  const matches = value === channelName

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.title}>delete channel</div>
        <p className={styles.warning}>
          this cannot be undone. type <span className={styles.channelName}>{channelName}</span> to confirm.
        </p>
        <form onSubmit={submit} className={styles.form}>
          <input
            autoFocus
            placeholder={channelName}
            value={value}
            onChange={e => setValue(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
          />
          <div className={styles.actions}>
            <button type="button" onClick={onClose}>cancel</button>
            <button type="submit" className={styles.deleteBtn} disabled={!matches}>delete</button>
          </div>
        </form>
      </div>
    </div>
  )
}
