import { useEffect, useRef, useState } from 'react'
import type { RemoteVideoTrack, LocalVideoTrack } from 'livekit-client'
import type { User } from '@gander/shared'
import styles from './VideoGrid.module.css'

export interface VideoTile {
  participantId: string
  track: RemoteVideoTrack | LocalVideoTrack
  isScreen: boolean
  isLocal: boolean
}

interface TileProps {
  tile: VideoTile
  label: string
  pinned?: boolean
  onPin?: () => void
  onUnpin?: () => void
}

function Tile({ tile, label, pinned, onPin, onUnpin }: TileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    tile.track.attach(el)
    return () => { tile.track.detach(el) }
  }, [tile.track])

  return (
    <div
      className={`${styles.tile}${pinned ? ` ${styles.pinned}` : ''}`}
      onClick={!pinned ? onPin : undefined}
      title={!pinned ? 'Click to pin' : undefined}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={tile.isLocal}
        className={styles.video}
        style={tile.isLocal && !tile.isScreen ? { transform: 'scaleX(-1)' } : undefined}
      />
      <span className={styles.label}>{label}{tile.isScreen ? ' [screen]' : ''}</span>
      {pinned && (
        <button className={styles.unpinBtn} onClick={onUnpin}>unpin</button>
      )}
    </div>
  )
}

interface Props {
  tiles: VideoTile[]
  users: User[]
  currentUserId: string
}

export default function VideoGrid({ tiles, users, currentUserId }: Props) {
  const [pinnedKey, setPinnedKey] = useState<string | null>(null)

  function labelFor(tile: VideoTile) {
    if (tile.participantId === currentUserId) return 'you'
    return users.find(u => u.id === tile.participantId)?.displayName ?? tile.participantId
  }

  function keyFor(tile: VideoTile) {
    return `${tile.participantId}-${tile.isScreen ? 'screen' : 'camera'}`
  }

  const pinnedTile = pinnedKey ? tiles.find(t => keyFor(t) === pinnedKey) ?? null : null
  const otherTiles = pinnedTile ? tiles.filter(t => keyFor(t) !== pinnedKey) : tiles

  if (pinnedTile) {
    return (
      <div className={`${styles.grid} ${styles.hasPinned}`}>
        <Tile
          key={keyFor(pinnedTile)}
          tile={pinnedTile}
          label={labelFor(pinnedTile)}
          pinned
          onUnpin={() => setPinnedKey(null)}
        />
        {otherTiles.length > 0 && (
          <div className={styles.filmstrip}>
            {otherTiles.map(tile => (
              <Tile
                key={keyFor(tile)}
                tile={tile}
                label={labelFor(tile)}
                onPin={() => setPinnedKey(keyFor(tile))}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={styles.grid}>
      {tiles.map(tile => (
        <Tile
          key={keyFor(tile)}
          tile={tile}
          label={labelFor(tile)}
          onPin={() => setPinnedKey(keyFor(tile))}
        />
      ))}
    </div>
  )
}
