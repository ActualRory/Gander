import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMediaQuery } from '../lib/useMediaQuery.ts'
import styles from './ContextMenu.module.css'

export interface ContextMenuItem {
  label: string
  danger?: boolean
  disabled?: boolean
  action: () => void
}

interface Props {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  // Coarse pointer → bottom sheet; fine pointer → anchored at the cursor
  const isSheet = useMediaQuery('(pointer: coarse)')

  useLayoutEffect(() => {
    if (isSheet || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    setPos({
      x: rect.right > window.innerWidth ? x - rect.width : x,
      y: rect.bottom > window.innerHeight ? y - rect.height : y,
    })
  }, [x, y, isSheet])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [onClose])

  const style: React.CSSProperties | undefined = isSheet ? undefined : { top: pos.y, left: pos.x }

  return createPortal(
    <>
      {isSheet && <div className={styles.backdrop} onClick={onClose} />}
      <div ref={ref} className={isSheet ? `${styles.menu} ${styles.sheet}` : styles.menu} style={style}>
        {items.map(item => (
          <button
            key={item.label}
            type="button"
            className={`${styles.item} ${item.danger ? styles.danger : ''} ${item.disabled ? styles.disabled : ''}`}
            disabled={item.disabled}
            onClick={() => { if (!item.disabled) { item.action(); onClose() } }}
          >
            &gt; {item.label}
          </button>
        ))}
      </div>
    </>,
    document.body
  )
}
