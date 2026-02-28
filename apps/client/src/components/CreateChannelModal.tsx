import { useEffect, useRef, useState } from 'react'
import styles from './CreateChannelModal.module.css'

interface Props {
  onConfirm: (name: string, type: 'TEXT' | 'VOICE') => void
  onClose: () => void
}

export default function CreateChannelModal({ onConfirm, onClose }: Props) {
  const [name, setName] = useState('')
  const [type, setType] = useState<'TEXT' | 'VOICE'>('TEXT')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    onConfirm(name.trim(), type)
  }

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.title}>new channel</div>

        <div className={styles.typeToggle}>
          <button
            type="button"
            className={`${styles.typeBtn} ${type === 'TEXT' ? styles.typeActive : ''}`}
            onClick={() => setType('TEXT')}
          >
            # text
          </button>
          <button
            type="button"
            className={`${styles.typeBtn} ${type === 'VOICE' ? styles.typeActive : ''}`}
            onClick={() => setType('VOICE')}
          >
            ▸ voice
          </button>
        </div>

        <form onSubmit={submit} className={styles.form}>
          <input
            ref={inputRef}
            placeholder="channel-name"
            value={name}
            onChange={e => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
          />
          <div className={styles.actions}>
            <button type="button" onClick={onClose}>cancel</button>
            <button type="submit" className={styles.confirmBtn}>create</button>
          </div>
        </form>
      </div>
    </div>
  )
}
