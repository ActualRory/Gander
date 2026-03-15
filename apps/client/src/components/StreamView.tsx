import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { User } from '@gander/shared'
import type { VideoTile } from './VideoGrid.tsx'
import styles from './StreamView.module.css'

function VideoTileEl({ tile, label, className, videoRef: externalVideoRef }: {
  tile: VideoTile
  label: string
  className?: string
  videoRef?: React.RefObject<HTMLVideoElement>
}) {
  const internalRef = useRef<HTMLVideoElement>(null)
  const videoRef = externalVideoRef ?? internalRef

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    tile.track.attach(el)
    return () => { tile.track.detach(el) }
  }, [tile.track, videoRef])

  return (
    <div className={`${styles.tile} ${className ?? ''}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={tile.isLocal}
        className={styles.video}
        style={tile.isLocal && !tile.isScreen ? { transform: 'scaleX(-1)' } : undefined}
      />
      <span className={styles.label}>{label}</span>
    </div>
  )
}

interface Props {
  screenTile: VideoTile
  cameraTiles: VideoTile[]
  users: User[]
  currentUserId: string
  streamerName: string
  streamVolume: number
  onSetStreamVolume: (vol: number) => void
  onClose: () => void
}

export default function StreamView({ screenTile, cameraTiles, users, currentUserId, streamerName, streamVolume, onSetStreamVolume, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const screenVideoRef = useRef<HTMLVideoElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [localVol, setLocalVol] = useState(Math.round(streamVolume * 100))
  const [preMuteVol, setPreMuteVol] = useState(100)
  const isMuted = localVol === 0
  const pipSupported = typeof document !== 'undefined' && 'pictureInPictureEnabled' in document

  // Keep localVol in sync when streamVolume changes externally
  useEffect(() => {
    setLocalVol(Math.round(streamVolume * 100))
  }, [streamVolume])

  // Close menu on Escape or click-outside
  useEffect(() => {
    if (!menu) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setMenu(null) }
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown) }
  }, [menu])

  // Flip menu if it would overflow the viewport
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    setMenuPos({
      x: rect.right > window.innerWidth ? menu.x - rect.width : menu.x,
      y: rect.bottom > window.innerHeight ? menu.y - rect.height : menu.y,
    })
  }, [menu])

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY })
    setMenuPos({ x: e.clientX, y: e.clientY })
  }

  function handleVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = Number(e.target.value)
    setLocalVol(val)
    onSetStreamVolume(val / 100)
  }

  function toggleMute() {
    if (isMuted) {
      const restore = preMuteVol || 100
      setLocalVol(restore)
      onSetStreamVolume(restore / 100)
    } else {
      setPreMuteVol(localVol)
      setLocalVol(0)
      onSetStreamVolume(0)
    }
  }

  function handleFullscreen() {
    rootRef.current?.requestFullscreen().catch(() => {})
    setMenu(null)
  }

  function handlePiP() {
    screenVideoRef.current?.requestPictureInPicture().catch(() => {})
    setMenu(null)
  }

  function labelFor(tile: VideoTile) {
    if (tile.participantId === currentUserId) return 'you'
    return users.find(u => u.id === tile.participantId)?.displayName ?? tile.participantId
  }

  return (
    <div ref={rootRef} className={styles.root}>
      <div className={styles.header}>
        <span className={styles.streamerLabel}>{streamerName} is streaming</span>
        <button type="button" className={styles.closeBtn} onClick={onClose}>[close]</button>
      </div>
      <div className={styles.screenArea} onContextMenu={handleContextMenu}>
        <VideoTileEl
          tile={screenTile}
          label={labelFor(screenTile)}
          className={styles.screenTile}
          videoRef={screenVideoRef}
        />
      </div>
      {cameraTiles.length > 0 && (
        <div className={styles.cameraStrip}>
          {cameraTiles.map(tile => (
            <VideoTileEl
              key={`${tile.participantId}-cam`}
              tile={tile}
              label={labelFor(tile)}
              className={styles.cameraTile}
            />
          ))}
        </div>
      )}

      {menu && createPortal(
        <div ref={menuRef} className={styles.contextMenu} style={{ top: menuPos.y, left: menuPos.x }}>
          <button type="button" className={styles.menuItem} onClick={toggleMute}>
            {isMuted ? 'unmute stream audio' : 'mute stream audio'}
          </button>
          <div className={styles.menuVolRow}>
            <span className={styles.menuVolLabel}>volume</span>
            <span className={styles.menuVolValue}>{localVol}%</span>
          </div>
          <input
            type="range"
            min={0} max={200} step={5}
            value={localVol}
            onChange={handleVolumeChange}
            className={styles.menuSlider}
            style={{ '--val': localVol / 200 } as React.CSSProperties}
          />
          <div className={styles.menuSliderHints}>
            <span>0%</span><span>100%</span><span>200%</span>
          </div>
          <div className={styles.menuDivider} />
          <button type="button" className={styles.menuItem} onClick={handleFullscreen}>
            fullscreen
          </button>
          {pipSupported && (
            <button type="button" className={styles.menuItem} onClick={handlePiP}>
              picture in picture
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
