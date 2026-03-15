import { useEffect, useState } from 'react'
import { api, resolveAttachmentUrl } from '../lib/api.ts'
import styles from './LinkPreviews.module.css'

type BookData = {
  id: string; title: string; author: string | null; series: string | null
  genre: string | null; coverUrl: string | null; mimeType: string; size: number
  shelf: { id: string; name: string } | null
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface Props {
  bookId: string
  token: string
  onNavigateToLibrary?: () => void
}

export default function BookLinkCard({ bookId, token, onNavigateToLibrary }: Props) {
  const [book, setBook] = useState<BookData | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    api.getLibraryBookPreview(token, bookId).then(b => setBook(b as BookData)).catch(() => setError(true))
  }, [bookId, token])

  if (error) return <span className={styles.linkCardError}>[book not found]</span>
  if (!book) return <span className={styles.linkCardLoading}>loading book...</span>

  const coverSrc = book.coverUrl
    ? (book.coverUrl.startsWith('http') ? book.coverUrl : resolveAttachmentUrl(book.coverUrl))
    : null

  return (
    <div
      className={styles.bookCard}
      role={onNavigateToLibrary ? 'link' : undefined}
      tabIndex={onNavigateToLibrary ? 0 : undefined}
      onClick={onNavigateToLibrary}
      onKeyDown={e => { if (e.key === 'Enter') onNavigateToLibrary?.() }}
    >
      {coverSrc && <img src={coverSrc} alt={book.title} className={styles.bookCardCover} loading="lazy" />}
      <div className={styles.bookCardBody}>
        <div className={styles.bookCardLabel}>library book</div>
        <div className={styles.bookCardTitle}>{book.title}</div>
        {book.author && <div className={styles.bookCardMeta}>{book.author}</div>}
        {book.series && <div className={styles.bookCardMeta}><em>{book.series}</em></div>}
        <div className={styles.bookCardMeta}>
          {book.genre && <span className={styles.genreTag}>{book.genre}</span>}
          {book.shelf && <span>on: {book.shelf.name}</span>}
          <span>{formatSize(book.size)}</span>
        </div>
      </div>
    </div>
  )
}
