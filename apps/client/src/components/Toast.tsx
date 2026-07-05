import { createPortal } from 'react-dom'
import styles from './Toast.module.css'

export type ToastVariant = 'info' | 'success' | 'error'

export interface ToastItem {
  id: number
  message: string
  variant: ToastVariant
}

const PREFIX: Record<ToastVariant, string> = {
  info: '[i]',
  success: '[ok]',
  error: '[!]',
}

interface Props {
  toasts: ToastItem[]
  onDismiss: (id: number) => void
}

export default function ToastStack({ toasts, onDismiss }: Props) {
  return createPortal(
    <div className={styles.stack} aria-live="polite" role="status">
      {toasts.map(t => (
        <button
          key={t.id}
          className={`${styles.toast} ${styles[t.variant]}`}
          onClick={() => onDismiss(t.id)}
          aria-label={`dismiss: ${t.message}`}
        >
          <span className={styles.prefix}>{PREFIX[t.variant]}</span>
          <span className={styles.message}>{t.message}</span>
        </button>
      ))}
    </div>,
    document.body,
  )
}
