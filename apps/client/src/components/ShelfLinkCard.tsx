import { useEffect, useState } from 'react'
import { api } from '../lib/api.ts'
import styles from './LinkPreviews.module.css'

type ShelfData = {
  id: string; name: string; description: string | null
  bookCount: number; totalSize: number
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

interface Props {
  shelfId: string
  token: string
  onNavigateToLibrary?: () => void
}

export default function ShelfLinkCard({ shelfId, token, onNavigateToLibrary }: Props) {
  const [shelf, setShelf] = useState<ShelfData | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    api.getLibraryShelfPreview(token, shelfId).then(s => setShelf(s as ShelfData)).catch(() => setError(true))
  }, [shelfId, token])

  if (error) return <span className={styles.linkCardError}>[shelf not found]</span>
  if (!shelf) return <span className={styles.linkCardLoading}>loading shelf...</span>

  return (
    <div
      className={styles.shelfCard}
      role={onNavigateToLibrary ? 'link' : undefined}
      tabIndex={onNavigateToLibrary ? 0 : undefined}
      onClick={onNavigateToLibrary}
      onKeyDown={e => { if (e.key === 'Enter') onNavigateToLibrary?.() }}
    >
      <div className={styles.bookCardBody}>
        <div className={styles.bookCardLabel}>library shelf</div>
        <div className={styles.bookCardTitle}>{shelf.name}</div>
        {shelf.description && <div className={styles.shelfCardDescription}>{shelf.description}</div>}
        <div className={styles.bookCardMeta}>
          <span>{shelf.bookCount} book{shelf.bookCount !== 1 ? 's' : ''}</span>
          {shelf.totalSize > 0 && <span>{formatSize(shelf.totalSize)}</span>}
        </div>
      </div>
    </div>
  )
}
