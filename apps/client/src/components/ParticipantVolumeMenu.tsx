import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './ParticipantVolumeMenu.module.css'

interface Props {
  x: number
  y: number
  userName: string
  userId: string
  volume: number // multiplier 0.0–2.0 (100% = 1.0)
  onSetVolume: (userId: string, vol: number) => void
  onClose: () => void
}

export default function ParticipantVolumeMenu({ x, y, userName, userId, volume, onSetVolume, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [localVol, setLocalVol] = useState(Math.round(volume * 100))

  useLayoutEffect(() => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    setPos({
      x: rect.right > window.innerWidth ? x - rect.width : x,
      y: rect.bottom > window.innerHeight ? y - rect.height : y,
    })
  }, [x, y])

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

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = Number(e.target.value)
    setLocalVol(val)
    onSetVolume(userId, val / 100)
  }

  return createPortal(
    <div ref={ref} className={styles.menu} style={{ top: pos.y, left: pos.x }}>
      <div className={styles.name}>{userName}</div>
      <div className={styles.row}>
        <span className={styles.label}>volume</span>
        <span className={styles.value}>{localVol}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={200}
        step={5}
        value={localVol}
        onChange={handleChange}
        className={styles.slider}
      />
      <div className={styles.hints}>
        <span>0%</span>
        <span>100%</span>
        <span>200%</span>
      </div>
    </div>,
    document.body
  )
}
