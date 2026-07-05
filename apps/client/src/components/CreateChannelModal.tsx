import { useEffect, useRef, useState } from 'react'
import { useFocusTrap } from '../lib/useFocusTrap.ts'
import styles from './CreateChannelModal.module.css'

interface Props {
  onConfirm: (name: string, type: 'TEXT' | 'VOICE') => void
  onClose: () => void
  initialType?: 'TEXT' | 'VOICE'
}

export default function CreateChannelModal({ onConfirm, onClose, initialType = 'TEXT' }: Props) {
  const [name, setName] = useState('')
  const [type, setType] = useState<'TEXT' | 'VOICE'>(initialType)
  const inputRef = useRef<HTMLInputElement>(null)
  const trapRef = useFocusTrap<HTMLDivElement>()

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
      <div className={styles.modal} ref={trapRef} role="dialog" aria-modal="true" aria-label="create channel">
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
