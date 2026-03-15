import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './AvatarCropModal.module.css'

// Display container dimensions
const CW = 340
const CH = 280
// Crop square
const CS = 200
const CX = (CW - CS) / 2  // 70
const CY = (CH - CS) / 2  // 40
// Output resolution
const OUT = 256

interface Props {
  file: File
  onConfirm: (blob: Blob) => void
  onCancel: () => void
}

export default function AvatarCropModal({ file, onConfirm, onCancel }: Props) {
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 })
  const [pos, setPos] = useState({ x: 0, y: 0, scale: 1 })
  const posRef = useRef({ x: 0, y: 0, scale: 1 })
  const dragRef = useRef<{ mx: number; my: number; ox: number; oy: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const isGif = file.type === 'image/gif'

  useEffect(() => {
    const url = URL.createObjectURL(file)
    setImgSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function handleImgLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget
    setNaturalSize({ w, h })
    // Scale image to fill crop square, centered on it
    const s = Math.max(CS / w, CS / h)
    const x = CX + (CS - w * s) / 2
    const y = CY + (CS - h * s) / 2
    posRef.current = { x, y, scale: s }
    setPos({ x, y, scale: s })
  }

  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    dragRef.current = { mx: e.clientX, my: e.clientY, ox: posRef.current.x, oy: posRef.current.y }
  }

  function handleTouchStart(e: React.TouchEvent) {
    const t = e.touches[0]
    dragRef.current = { mx: t.clientX, my: t.clientY, ox: posRef.current.x, oy: posRef.current.y }
  }

  useEffect(() => {
    const container = containerRef.current!

    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current) return
      const x = dragRef.current.ox + e.clientX - dragRef.current.mx
      const y = dragRef.current.oy + e.clientY - dragRef.current.my
      posRef.current = { ...posRef.current, x, y }
      setPos(p => ({ ...p, x, y }))
    }

    function onMouseUp() {
      dragRef.current = null
    }

    function onTouchMove(e: TouchEvent) {
      if (!dragRef.current) return
      e.preventDefault()
      const t = e.touches[0]
      const x = dragRef.current.ox + t.clientX - dragRef.current.mx
      const y = dragRef.current.oy + t.clientY - dragRef.current.my
      posRef.current = { ...posRef.current, x, y }
      setPos(p => ({ ...p, x, y }))
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const { x, y, scale } = posRef.current
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      const newScale = Math.max(0.05, Math.min(20, scale * factor))
      // Zoom centered on crop square center
      const cx = CX + CS / 2
      const cy = CY + CS / 2
      const newX = cx - (cx - x) * (newScale / scale)
      const newY = cy - (cy - y) * (newScale / scale)
      posRef.current = { x: newX, y: newY, scale: newScale }
      setPos({ x: newX, y: newY, scale: newScale })
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('touchend', onMouseUp)
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    container.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('touchend', onMouseUp)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('wheel', onWheel)
    }
  }, [])

  function zoom(factor: number) {
    const { x, y, scale } = posRef.current
    const newScale = Math.max(0.05, Math.min(20, scale * factor))
    const cx = CX + CS / 2
    const cy = CY + CS / 2
    const newX = cx - (cx - x) * (newScale / scale)
    const newY = cy - (cy - y) * (newScale / scale)
    posRef.current = { x: newX, y: newY, scale: newScale }
    setPos({ x: newX, y: newY, scale: newScale })
  }

  function handleConfirm() {
    const img = imgRef.current
    if (!img) return
    const canvas = document.createElement('canvas')
    canvas.width = OUT
    canvas.height = OUT
    const ctx = canvas.getContext('2d')!
    // Fill background so transparent PNGs look sensible
    ctx.fillStyle = '#1a1a0e'
    ctx.fillRect(0, 0, OUT, OUT)
    const { x, y, scale } = posRef.current
    const srcX = (CX - x) / scale
    const srcY = (CY - y) / scale
    const srcW = CS / scale
    const srcH = CS / scale
    ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, OUT, OUT)
    canvas.toBlob(blob => { if (blob) onConfirm(blob) }, 'image/png')
  }

  const ready = naturalSize.w > 0

  return createPortal(
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span>crop profile photo</span>
          <button type="button" className={styles.closeBtn} onClick={onCancel}>✕</button>
        </div>

        <div
          ref={containerRef}
          className={styles.canvas}
          style={{ width: CW, height: CH }}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
        >
          {imgSrc && (
            <img
              ref={imgRef}
              src={imgSrc}
              alt=""
              className={styles.img}
              style={{
                left: pos.x,
                top: pos.y,
                width: naturalSize.w * pos.scale,
                height: naturalSize.h * pos.scale,
              }}
              onLoad={handleImgLoad}
              draggable={false}
            />
          )}
          <svg
            className={styles.svgOverlay}
            width={CW}
            height={CH}
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <mask id="avatarCropHole">
                <rect width={CW} height={CH} fill="white" />
                <rect x={CX} y={CY} width={CS} height={CS} fill="black" />
              </mask>
            </defs>
            <rect width={CW} height={CH} fill="rgba(0,0,0,0.65)" mask="url(#avatarCropHole)" />
            <rect x={CX} y={CY} width={CS} height={CS} fill="none" stroke="rgba(200,169,110,0.5)" strokeWidth="1" />
          </svg>
        </div>

        <div className={styles.controls}>
          <button type="button" className={styles.zoomBtn} onClick={() => zoom(1 / 1.2)} title="zoom out">−</button>
          <button type="button" className={styles.zoomBtn} onClick={() => zoom(1.2)} title="zoom in">+</button>
          <span className={styles.hint}>
            drag · scroll to zoom
            {isGif && <span className={styles.gifNote}> · gif: still frame</span>}
          </span>
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onCancel}>cancel</button>
          <button type="button" className={styles.confirmBtn} onClick={handleConfirm} disabled={!ready}>
            set photo
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
