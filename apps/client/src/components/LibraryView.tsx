import { useEffect, useRef, useState } from 'react'
import { api, resolveAttachmentUrl } from '../lib/api.ts'
import styles from './LibraryView.module.css'

type LibraryShelf = { id: string; name: string; createdAt: string; creatorId: string; _count: { books: number } }
type LibraryBook = { id: string; title: string; filename: string; storedName: string; mimeType: string; size: number; coverUrl: string | null; uploadedAt: string; uploaderId: string; uploader: { displayName: string } }

interface Props {
  token: string
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function mimeLabel(mime: string): string {
  if (mime === 'application/pdf') return 'PDF'
  if (mime === 'application/epub+zip') return 'EPUB'
  if (mime === 'text/plain') return 'TXT'
  return mime.split('/')[1]?.toUpperCase() ?? mime
}

export default function LibraryView({ token }: Props) {
  const [shelves, setShelves] = useState<LibraryShelf[]>([])
  const [selectedShelfId, setSelectedShelfId] = useState<string | null>(null)
  const [books, setBooks] = useState<LibraryBook[]>([])
  const [loadingBooks, setLoadingBooks] = useState(false)
  const [newShelfName, setNewShelfName] = useState('')
  const [creatingShelf, setCreatingShelf] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadCover, setUploadCover] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { fetchShelves() }, [])

  useEffect(() => {
    if (!selectedShelfId) { setBooks([]); return }
    fetchBooks(selectedShelfId)
  }, [selectedShelfId])

  async function fetchShelves() {
    try {
      const data = await api.getLibraryShelves(token)
      setShelves(data)
      if (data.length > 0) setSelectedShelfId(id => id ?? data[0].id)
    } catch {
      setError('failed to load shelves')
    }
  }

  async function fetchBooks(shelfId: string) {
    setLoadingBooks(true)
    try {
      const data = await api.getLibraryBooks(token, shelfId)
      setBooks(data)
    } catch {
      setError('failed to load books')
    } finally {
      setLoadingBooks(false)
    }
  }

  async function handleCreateShelf(e: React.FormEvent) {
    e.preventDefault()
    if (!newShelfName.trim()) return
    try {
      const shelf = await api.createLibraryShelf(token, newShelfName.trim())
      setShelves(prev => [...prev, shelf])
      setSelectedShelfId(shelf.id)
      setNewShelfName('')
      setCreatingShelf(false)
    } catch {
      setError('failed to create shelf')
    }
  }

  async function handleDeleteShelf(shelfId: string) {
    if (!confirm('delete this shelf and all its books?')) return
    try {
      await api.deleteLibraryShelf(token, shelfId)
      setShelves(prev => prev.filter(s => s.id !== shelfId))
      setSelectedShelfId(prev => {
        if (prev !== shelfId) return prev
        const remaining = shelves.filter(s => s.id !== shelfId)
        return remaining[0]?.id ?? null
      })
    } catch {
      setError('failed to delete shelf')
    }
  }

  async function handleUploadBook(e: React.FormEvent) {
    e.preventDefault()
    if (!uploadFile || !selectedShelfId) return
    setUploading(true)
    try {
      const book = await api.uploadLibraryBook(token, selectedShelfId, uploadFile, uploadTitle, uploadCover)
      setBooks(prev => [...prev, book as LibraryBook])
      setShelves(prev => prev.map(s => s.id === selectedShelfId
        ? { ...s, _count: { books: s._count.books + 1 } }
        : s))
      setUploadOpen(false)
      setUploadTitle('')
      setUploadFile(null)
      setUploadCover(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleDeleteBook(bookId: string) {
    if (!selectedShelfId) return
    try {
      await api.deleteLibraryBook(token, selectedShelfId, bookId)
      setBooks(prev => prev.filter(b => b.id !== bookId))
      setShelves(prev => prev.map(s => s.id === selectedShelfId
        ? { ...s, _count: { books: Math.max(0, s._count.books - 1) } }
        : s))
    } catch {
      setError('failed to delete book')
    }
  }

  const selectedShelf = shelves.find(s => s.id === selectedShelfId) ?? null

  return (
    <div className={styles.root}>
      {error && (
        <div className={styles.errorBanner}>
          {error}
          <button type="button" onClick={() => setError(null)}> [x]</button>
        </div>
      )}

      <div className={styles.layout}>
        {/* Left panel: shelves */}
        <aside className={styles.shelfPanel}>
          <div className={styles.shelfHeader}>
            <span className={styles.panelTitle}>shelves</span>
            <button type="button" className={styles.iconBtn} onClick={() => setCreatingShelf(true)} title="new shelf">
              [+]
            </button>
          </div>

          {creatingShelf && (
            <form onSubmit={handleCreateShelf} className={styles.newShelfForm}>
              <input
                autoFocus
                placeholder="shelf name"
                value={newShelfName}
                onChange={e => setNewShelfName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') { setCreatingShelf(false); setNewShelfName('') } }}
                onBlur={() => { if (!newShelfName.trim()) setCreatingShelf(false) }}
              />
            </form>
          )}

          <div className={styles.shelfList}>
            {shelves.map(shelf => (
              <div key={shelf.id} className={styles.shelfRow}>
                <button
                  type="button"
                  className={`${styles.shelfBtn} ${shelf.id === selectedShelfId ? styles.shelfActive : ''}`}
                  onClick={() => setSelectedShelfId(shelf.id)}
                >
                  <span className={styles.shelfName}>{shelf.name}</span>
                  <span className={styles.shelfCount}>[{shelf._count.books}]</span>
                </button>
                <button
                  type="button"
                  className={styles.deleteShelfBtn}
                  onClick={() => handleDeleteShelf(shelf.id)}
                  title="delete shelf"
                >
                  [x]
                </button>
              </div>
            ))}
            {shelves.length === 0 && !creatingShelf && (
              <div className={styles.empty}>no shelves yet</div>
            )}
          </div>
        </aside>

        {/* Right panel: books */}
        <main className={styles.bookPanel}>
          <div className={styles.bookHeader}>
            <div className={styles.headerLeft}>
              <span className={styles.libraryTitle}>THE LIBRARY</span>
              {selectedShelf && <span className={styles.shelfLabel}>/ {selectedShelf.name}</span>}
            </div>
            {selectedShelfId && (
              <button type="button" className={styles.iconBtn} onClick={() => setUploadOpen(true)}>
                [+ add book]
              </button>
            )}
          </div>

          {loadingBooks && <div className={styles.loading}>loading...</div>}

          {!loadingBooks && selectedShelfId && books.length === 0 && (
            <div className={styles.empty}>no books on this shelf yet — add one with [+ add book]</div>
          )}

          {!selectedShelfId && (
            <div className={styles.empty}>select or create a shelf to get started</div>
          )}

          <div className={styles.bookGrid}>
            {books.map(book => (
              <div key={book.id} className={styles.bookCard}>
                <a
                  href={resolveAttachmentUrl(`/uploads/${book.storedName}`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.bookCoverLink}
                  title={`open ${book.title}`}
                >
                  {book.coverUrl
                    ? <img src={resolveAttachmentUrl(book.coverUrl)} alt={book.title} className={styles.bookCover} />
                    : (
                      <div className={styles.bookCoverPlaceholder}>
                        <span className={styles.mimeLabel}>{mimeLabel(book.mimeType)}</span>
                      </div>
                    )}
                </a>
                <div className={styles.bookMeta}>
                  <div className={styles.bookTitle}>{book.title}</div>
                  <div className={styles.bookSub}>by {book.uploader.displayName}</div>
                  <div className={styles.bookSub}>{mimeLabel(book.mimeType)} · {formatSize(book.size)}</div>
                  <button type="button" className={styles.deleteBookBtn} onClick={() => handleDeleteBook(book.id)}>
                    [delete]
                  </button>
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>

      {/* Upload modal */}
      {uploadOpen && (
        <div className={styles.modalOverlay} onClick={e => e.target === e.currentTarget && setUploadOpen(false)}>
          <div className={styles.modal}>
            <div className={styles.modalTitle}>add book to "{selectedShelf?.name}"</div>
            <form onSubmit={handleUploadBook} className={styles.uploadForm}>
              <label className={styles.formLabel}>
                title (optional)
                <input
                  type="text"
                  value={uploadTitle}
                  onChange={e => setUploadTitle(e.target.value)}
                  placeholder="leave blank to use filename"
                  className={styles.formInput}
                />
              </label>

              <label className={styles.formLabel}>
                book file (PDF, EPUB, TXT) *
                <button type="button" className={styles.filePickerBtn} onClick={() => fileInputRef.current?.click()}>
                  {uploadFile ? uploadFile.name : '[choose file]'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.epub,.txt,application/pdf,application/epub+zip,text/plain"
                  style={{ display: 'none' }}
                  onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
                />
              </label>

              <label className={styles.formLabel}>
                cover image (optional)
                <button type="button" className={styles.filePickerBtn} onClick={() => coverInputRef.current?.click()}>
                  {uploadCover ? uploadCover.name : '[choose cover]'}
                </button>
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  style={{ display: 'none' }}
                  onChange={e => setUploadCover(e.target.files?.[0] ?? null)}
                />
              </label>

              <div className={styles.formActions}>
                <button type="submit" className={styles.submitBtn} disabled={!uploadFile || uploading}>
                  {uploading ? 'uploading...' : '[upload]'}
                </button>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => { setUploadOpen(false); setUploadFile(null); setUploadCover(null); setUploadTitle('') }}
                >
                  [cancel]
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
