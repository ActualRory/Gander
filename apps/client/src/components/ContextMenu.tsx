import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import styles from './ContextMenu.module.css'

export interface ContextMenuItem {
  label: string
  danger?: boolean
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

  // Keep menu on screen
  const style: React.CSSProperties = {
    top: y,
    left: x,
  }

  return createPortal(
    <div ref={ref} className={styles.menu} style={style}>
      {items.map(item => (
        <button
          key={item.label}
          type="button"
          className={`${styles.item} ${item.danger ? styles.danger : ''}`}
          onClick={() => { item.action(); onClose() }}
        >
          &gt; {item.label}
        </button>
      ))}
    </div>,
    document.body
  )
}
