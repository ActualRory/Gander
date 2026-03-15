import { useEffect, useRef } from 'react'
import type { RemoteVideoTrack, LocalVideoTrack } from 'livekit-client'
import type { User } from '@gander/shared'
import styles from './VideoGrid.module.css'

export interface VideoTile {
  participantId: string
  track: RemoteVideoTrack | LocalVideoTrack
  isScreen: boolean
  isLocal: boolean
}

interface TileProps { tile: VideoTile; label: string }

function Tile({ tile, label }: TileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    tile.track.attach(el)
    return () => { tile.track.detach(el) }
  }, [tile.track])

  return (
    <div className={styles.tile}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={tile.isLocal}
        className={styles.video}
        style={tile.isLocal && !tile.isScreen ? { transform: 'scaleX(-1)' } : undefined}
      />
      <span className={styles.label}>{label}{tile.isScreen ? ' [screen]' : ''}</span>
    </div>
  )
}

interface Props {
  tiles: VideoTile[]
  users: User[]
  currentUserId: string
}

export default function VideoGrid({ tiles, users, currentUserId }: Props) {
  function labelFor(tile: VideoTile) {
    if (tile.participantId === currentUserId) return 'you'
    return users.find(u => u.id === tile.participantId)?.displayName ?? tile.participantId
  }

  return (
    <div className={styles.grid}>
      {tiles.map(tile => (
        <Tile
          key={`${tile.participantId}-${tile.isScreen ? 'screen' : 'camera'}`}
          tile={tile}
          label={labelFor(tile)}
        />
      ))}
    </div>
  )
}
