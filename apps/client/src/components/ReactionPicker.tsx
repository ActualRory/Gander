import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './ReactionPicker.module.css'

export const REACTIONS = [
  '+1', '-1', 'lol', 'rip', 'gg', '<3', 'o7', 'wtf', 'F', 'nice', 'lmao', 'yikes', 'pog', 'based', 'honk',
  'done', 'rad', 'yes', 'no', 'maybe', 'idk', 'owo',
]

const EASTER_EGG_REACTION = 'can you repeat the question?'
const EASTER_EGG_TRIGGERS = new Set(['yes', 'no', 'maybe', 'idk'])

interface Props {
  x: number
  y: number
  existingReactions?: string[]
  onSelect: (reaction: string) => void
  onClose: () => void
}

export default function ReactionPicker({ x, y, existingReactions = [], onSelect, onClose }: Props) {
  const showEasterEgg = EASTER_EGG_TRIGGERS.size > 0 &&
    [...EASTER_EGG_TRIGGERS].every(r => existingReactions.includes(r))
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: y, left: x })

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

  useLayoutEffect(() => {
    if (!ref.current) return
    const W = 252
    const h = ref.current.offsetHeight
    const clampedX = Math.min(x, window.innerWidth - W - 8)
    const clampedY = y + h > window.innerHeight - 8 ? Math.max(8, y - h) : y
    setPos({ top: clampedY, left: clampedX })
  }, [x, y])

  return createPortal(
    <div ref={ref} className={styles.picker} style={{ top: pos.top, left: pos.left }}>
      <div className={styles.label}>add reaction</div>
      <div className={styles.grid}>
        {[...REACTIONS, ...(showEasterEgg ? [EASTER_EGG_REACTION] : [])].map(r => (
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
