import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import styles from './ReactionPicker.module.css'

export const REACTIONS = [
  '+1', '-1', 'lol', 'rip', 'gg', '<3', 'o7', 'wtf', 'F', 'nice', 'lmao', 'yikes', 'pog', 'based', 'honk',
]

interface Props {
  x: number
  y: number
  onSelect: (reaction: string) => void
  onClose: () => void
}

export default function ReactionPicker({ x, y, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onMouseDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onMouseDown)
    }
  }, [onClose])

  // Clamp to viewport
  const W = 252
  const clampedX = Math.min(x, window.innerWidth - W - 8)
  const clampedY = Math.min(y, window.innerHeight - 100)

  return createPortal(
    <div ref={ref} className={styles.picker} style={{ top: clampedY, left: clampedX }}>
      <div className={styles.label}>add reaction</div>
      <div className={styles.grid}>
        {REACTIONS.map(r => (
          <button
            key={r}
            type="button"
            className={styles.tag}
            onClick={() => { onSelect(r); onClose() }}
          >
            [{r}]
          </button>
        ))}
      </div>
    </div>,
    document.body
  )
}
