import { useEffect, useRef } from 'react'
import type { User } from '@gander/shared'
import type { VideoTile } from './VideoGrid.tsx'
import styles from './StreamView.module.css'

function VideoTileEl({ tile, label, className }: { tile: VideoTile; label: string; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    tile.track.attach(el)
    return () => { tile.track.detach(el) }
  }, [tile.track])

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
  onClose: () => void
}

export default function StreamView({ screenTile, cameraTiles, users, currentUserId, streamerName, onClose }: Props) {
  function labelFor(tile: VideoTile) {
    if (tile.participantId === currentUserId) return 'you'
    return users.find(u => u.id === tile.participantId)?.displayName ?? tile.participantId
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.streamerLabel}>{streamerName} is streaming</span>
        <button type="button" className={styles.closeBtn} onClick={onClose}>[close]</button>
      </div>
      <div className={styles.screenArea}>
        <VideoTileEl tile={screenTile} label={labelFor(screenTile)} className={styles.screenTile} />
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
    </div>
  )
}
