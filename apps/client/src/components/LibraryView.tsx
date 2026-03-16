import { useEffect, useRef, useState } from 'react'
import { api, resolveAttachmentUrl } from '../lib/api.ts'
import ContextMenu, { type ContextMenuItem } from './ContextMenu.tsx'
import styles from './LibraryView.module.css'

type LibraryShelf = {
  id: string; name: string; description: string | null; createdAt: string; creatorId: string
  _count: { books: number }
}
type LibraryBook = {
  id: string; title: string; author: string | null; series: string | null; genre: string | null
  filename: string; storedName: string; mimeType: string; size: number
  coverUrl: string | null; uploadedAt: string; uploaderId: string
  uploader: { displayName: string }
  shelf?: { id: string; name: string }
}
type LibraryReview = {
  id: string; rating: number; comment: string | null; createdAt: string
  reviewerId: string; reviewer: { displayName: string }
}

type SortKey = 'title' | 'author' | 'series'

const GENRES = ['fiction', 'non-fiction', 'RPG', 'other'] as const
type Genre = typeof GENRES[number]

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

function sortBooks(books: LibraryBook[], key: SortKey): LibraryBook[] {
  return [...books].sort((a, b) => {
    const av = (a[key] ?? '').toLowerCase()
    const bv = (b[key] ?? '').toLowerCase()
    if (!av && bv) return 1
    if (av && !bv) return -1
    const primary = av.localeCompare(bv)
    if (primary !== 0) return primary
    // Secondary: title when sorting by series or author
    if (key !== 'title') {
      return (a.title ?? '').toLowerCase().localeCompare((b.title ?? '').toLowerCase())
    }
    return 0
  })
}

function formatRelativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

function Stars({ value, max = 5 }: { value: number; max?: number }) {
  const filled = Math.round(value)
  return (
    <span className={styles.stars}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={i < filled ? styles.starFull : styles.starEmpty}>★</span>
      ))}
    </span>
  )
}

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0)
  const active = hover || value
  return (
    <span className={styles.starPicker}>
      {Array.from({ length: 5 }, (_, i) => (
        <button
          key={i}
          type="button"
          className={active > i ? styles.starPickerFull : styles.starPickerEmpty}
          onMouseEnter={() => setHover(i + 1)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(i + 1)}
        >★</button>
      ))}
    </span>
  )
}

function parseTokenUserId(token: string): string {
  try { return (JSON.parse(atob(token.split('.')[1])) as { userId?: string }).userId ?? '' } catch { return '' }
}

export default function LibraryView({ token }: Props) {
  const [shelves, setShelves] = useState<LibraryShelf[]>([])
  const [selectedShelfId, setSelectedShelfId] = useState<string | null>(null)
  const [books, setBooks] = useState<LibraryBook[]>([])
  const [loadingBooks, setLoadingBooks] = useState(false)
  const [sortBy, setSortBy] = useState<SortKey>('series')

  // Search mode
  const [searchQuery, setSearchQuery] = useState('')
  const [searchGenre, setSearchGenre] = useState<Genre | ''>('')
  const [searchResults, setSearchResults] = useState<LibraryBook[] | null>(null)
  const [searching, setSearching] = useState(false)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Shelf creation
  const [newShelfName, setNewShelfName] = useState('')
  const [creatingShelf, setCreatingShelf] = useState(false)

  // Shelf edit modal (rename + description)
  const [editingShelf, setEditingShelf] = useState<LibraryShelf | null>(null)
  const [editShelfName, setEditShelfName] = useState('')
  const [editShelfDescription, setEditShelfDescription] = useState('')
  const [savingShelf, setSavingShelf] = useState(false)

  // Shelf context menu
  const [shelfMenu, setShelfMenu] = useState<{ shelf: LibraryShelf; x: number; y: number } | null>(null)

  // Drag-and-drop
  const [dragBookId, setDragBookId] = useState<string | null>(null)
  const [dragSourceShelfId, setDragSourceShelfId] = useState<string | null>(null)
  const [dragOverShelfId, setDragOverShelfId] = useState<string | null>(null)

  // Upload
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadAuthor, setUploadAuthor] = useState('')
  const [uploadSeries, setUploadSeries] = useState('')
  const [uploadGenre, setUploadGenre] = useState<Genre | ''>('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadCover, setUploadCover] = useState<File | null>(null)
  const [uploadCoverUrl, setUploadCoverUrl] = useState('')
  const [uploading, setUploading] = useState(false)

  // Book context menu
  const [bookMenu, setBookMenu] = useState<{ book: LibraryBook; x: number; y: number } | null>(null)

  // Book delete confirm (type-title modal)
  const [deleteBookConfirm, setDeleteBookConfirm] = useState<LibraryBook | null>(null)
  const [deleteBookInput, setDeleteBookInput] = useState('')

  // Edit book
  const [editBook, setEditBook] = useState<LibraryBook | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editAuthor, setEditAuthor] = useState('')
  const [editSeries, setEditSeries] = useState('')
  const [editGenre, setEditGenre] = useState<Genre | ''>('')
  const [editCoverFile, setEditCoverFile] = useState<File | null>(null)
  const [editCoverUrl, setEditCoverUrl] = useState('')
  const [saving, setSaving] = useState(false)

  // Book detail modal + reviews
  const [detailBook, setDetailBook] = useState<LibraryBook | null>(null)
  const [detailReviews, setDetailReviews] = useState<LibraryReview[]>([])
  const [detailAvgRating, setDetailAvgRating] = useState<number | null>(null)
  const [detailReviewCount, setDetailReviewCount] = useState(0)
  const [detailLoading, setDetailLoading] = useState(false)
  const [reviewRating, setReviewRating] = useState(0)
  const [reviewComment, setReviewComment] = useState('')
  const [submittingReview, setSubmittingReview] = useState(false)

  // Book requests
  type BookRequest = { id: string; title: string; author: string | null; notes: string | null; completed: boolean; requestedAt: string; requesterId: string; requester: { displayName: string } }
  const [requestsOpen, setRequestsOpen] = useState(false)
  const [requests, setRequests] = useState<BookRequest[]>([])
  const [completedRequests, setCompletedRequests] = useState<BookRequest[]>([])
  const [requestsLoading, setRequestsLoading] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  const [newRequestTitle, setNewRequestTitle] = useState('')
  const [newRequestAuthor, setNewRequestAuthor] = useState('')
  const [newRequestNotes, setNewRequestNotes] = useState('')
  const [submittingRequest, setSubmittingRequest] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const editCoverInputRef = useRef<HTMLInputElement>(null)

  const myUserId = parseTokenUserId(token)

  useEffect(() => { fetchShelves() }, [])

  useEffect(() => {
    if (!selectedShelfId) { setBooks([]); return }
    fetchBooks(selectedShelfId)
  }, [selectedShelfId])

  // Debounced search
  useEffect(() => {
    if (!searchQuery && !searchGenre) {
      setSearchResults(null)
      return
    }
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await api.searchLibraryBooks(token, {
          q: searchQuery || undefined,
          genre: searchGenre || undefined,
        })
        setSearchResults(results as LibraryBook[])
      } catch {
        setError('search failed')
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current) }
  }, [searchQuery, searchGenre])

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

  async function openBookDetail(book: LibraryBook) {
    setDetailBook(book)
    setDetailReviews([])
    setDetailAvgRating(null)
    setDetailReviewCount(0)
    setReviewRating(0)
    setReviewComment('')
    setDetailLoading(true)
    try {
      const data = await api.getBookReviews(token, book.id)
      setDetailReviews(data.reviews)
      setDetailAvgRating(data.avgRating)
      setDetailReviewCount(data.reviewCount)
      const mine = data.reviews.find(r => r.reviewerId === myUserId)
      if (mine) { setReviewRating(mine.rating); setReviewComment(mine.comment ?? '') }
    } catch {
      setError('failed to load reviews')
    } finally {
      setDetailLoading(false)
    }
  }

  function closeBookDetail() {
    setDetailBook(null)
    setDetailReviews([])
    setReviewRating(0)
    setReviewComment('')
  }

  async function handleSubmitReview(e: React.FormEvent) {
    e.preventDefault()
    if (!detailBook || reviewRating < 1) return
    setSubmittingReview(true)
    try {
      const review = await api.submitBookReview(token, detailBook.id, reviewRating, reviewComment)
      setDetailReviews(prev => {
        const existing = prev.findIndex(r => r.reviewerId === myUserId)
        if (existing >= 0) {
          const updated = [...prev]
          updated[existing] = review
          return updated
        }
        return [review, ...prev]
      })
      const allRatings = [...detailReviews.filter(r => r.reviewerId !== myUserId), review]
      const avg = allRatings.reduce((s, r) => s + r.rating, 0) / allRatings.length
      setDetailAvgRating(avg)
      setDetailReviewCount(allRatings.length)
    } catch {
      setError('failed to submit review')
    } finally {
      setSubmittingReview(false)
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

  function openEditShelf(shelf: LibraryShelf) {
    setEditingShelf(shelf)
    setEditShelfName(shelf.name)
    setEditShelfDescription(shelf.description ?? '')
    setShelfMenu(null)
  }

  function closeEditShelf() {
    setEditingShelf(null)
    setEditShelfName('')
    setEditShelfDescription('')
  }

  async function handleSaveShelf(e: React.FormEvent) {
    e.preventDefault()
    if (!editingShelf || !editShelfName.trim()) return
    setSavingShelf(true)
    try {
      const updated = await api.updateLibraryShelf(token, editingShelf.id, {
        name: editShelfName.trim(),
        description: editShelfDescription.trim() || null,
      }) as LibraryShelf
      setShelves(prev => prev.map(s => s.id === editingShelf.id
        ? { ...s, name: updated.name, description: updated.description }
        : s))
      closeEditShelf()
    } catch {
      setError('failed to save shelf')
    } finally {
      setSavingShelf(false)
    }
  }

  async function handleDeleteShelf(shelfId: string) {
    const shelf = shelves.find(s => s.id === shelfId)
    if (!shelf || shelf._count.books > 0) return
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
      const book = await api.uploadLibraryBook(
        token, selectedShelfId, uploadFile, uploadTitle, uploadCover,
        uploadAuthor || undefined, uploadSeries || undefined, uploadGenre || undefined,
        uploadCoverUrl && !uploadCover ? uploadCoverUrl : undefined,
      ) as LibraryBook
      setBooks(prev => [...prev, book])
      setShelves(prev => prev.map(s => s.id === selectedShelfId
        ? { ...s, _count: { books: s._count.books + 1 } }
        : s))
      setUploadOpen(false)
      setUploadTitle('')
      setUploadAuthor('')
      setUploadSeries('')
      setUploadGenre('')
      setUploadFile(null)
      setUploadCover(null)
      setUploadCoverUrl('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed')
    } finally {
      setUploading(false)
    }
  }

  function openDeleteBookConfirm(book: LibraryBook) {
    setDeleteBookConfirm(book)
    setDeleteBookInput('')
    setBookMenu(null)
  }

  async function handleDeleteBook() {
    if (!deleteBookConfirm) return
    const book = deleteBookConfirm
    const targetShelfId = book.shelf?.id ?? selectedShelfId
    if (!targetShelfId) return
    try {
      await api.deleteLibraryBook(token, targetShelfId, book.id)
      setBooks(prev => prev.filter(b => b.id !== book.id))
      if (searchResults) setSearchResults(prev => prev?.filter(b => b.id !== book.id) ?? null)
      setShelves(prev => prev.map(s => s.id === targetShelfId
        ? { ...s, _count: { books: Math.max(0, s._count.books - 1) } }
        : s))
      setDeleteBookConfirm(null)
      setDeleteBookInput('')
    } catch {
      setError('failed to delete book')
    }
  }

  function openEditBook(book: LibraryBook) {
    setEditBook(book)
    setEditTitle(book.title)
    setEditAuthor(book.author ?? '')
    setEditSeries(book.series ?? '')
    setEditGenre((book.genre as Genre | null) ?? '')
    setEditCoverFile(null)
    setEditCoverUrl('')
    setBookMenu(null)
  }

  function closeEditBook() {
    setEditBook(null)
    setEditCoverFile(null)
    setEditCoverUrl('')
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editBook) return
    setSaving(true)
    try {
      const shelfId = editBook.shelf?.id ?? selectedShelfId
      if (!shelfId) return

      const updated = await api.updateLibraryBook(token, shelfId, editBook.id, {
        title: editTitle || editBook.title,
        author: editAuthor || undefined,
        series: editSeries || undefined,
        genre: editGenre || undefined,
        ...(editCoverUrl && !editCoverFile ? { coverUrl: editCoverUrl } : {}),
      }) as LibraryBook

      let finalBook: LibraryBook = updated
      if (editCoverFile) {
        finalBook = await api.updateLibraryBookCover(token, shelfId, editBook.id, editCoverFile) as LibraryBook
      }

      setBooks(prev => prev.map(b => b.id === editBook.id ? { ...b, ...finalBook } : b))
      if (searchResults) setSearchResults(prev => prev?.map(b => b.id === editBook.id ? { ...b, ...finalBook } : b) ?? null)
      closeEditBook()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleDrop(targetShelfId: string) {
    setDragOverShelfId(null)
    if (!dragBookId || targetShelfId === dragSourceShelfId) { setDragBookId(null); setDragSourceShelfId(null); return }
    const fromShelfId = dragSourceShelfId
    if (!fromShelfId) { setDragBookId(null); return }
    try {
      await api.moveLibraryBook(token, fromShelfId, dragBookId, targetShelfId)
      if (fromShelfId === selectedShelfId) {
        setBooks(prev => prev.filter(b => b.id !== dragBookId))
      }
      if (searchResults) {
        setSearchResults(prev => prev?.map(b => b.id === dragBookId
          ? { ...b, shelfId: targetShelfId, shelf: shelves.find(s => s.id === targetShelfId) ? { id: targetShelfId, name: shelves.find(s => s.id === targetShelfId)!.name } : b.shelf }
          : b) ?? null)
      }
      setShelves(prev => prev.map(s => {
        if (s.id === fromShelfId) return { ...s, _count: { books: Math.max(0, s._count.books - 1) } }
        if (s.id === targetShelfId) return { ...s, _count: { books: s._count.books + 1 } }
        return s
      }))
    } catch {
      setError('failed to move book')
    } finally {
      setDragBookId(null)
      setDragSourceShelfId(null)
    }
  }

  async function openRequests() {
    setRequestsOpen(true)
    setShowCompleted(false)
    setRequestsLoading(true)
    try {
      const [open, done] = await Promise.all([
        api.getBookRequests(token, false),
        api.getBookRequests(token, true),
      ])
      setRequests(open)
      setCompletedRequests(done)
    } catch {
      setError('failed to load book requests')
    } finally {
      setRequestsLoading(false)
    }
  }

  async function handleSubmitRequest(e: React.FormEvent) {
    e.preventDefault()
    if (!newRequestTitle.trim()) return
    setSubmittingRequest(true)
    try {
      const req = await api.createBookRequest(token, newRequestTitle.trim(), newRequestAuthor || undefined, newRequestNotes || undefined)
      setRequests(prev => [req, ...prev])
      setNewRequestTitle('')
      setNewRequestAuthor('')
      setNewRequestNotes('')
    } catch {
      setError('failed to submit request')
    } finally {
      setSubmittingRequest(false)
    }
  }

  async function handleCompleteRequest(id: string) {
    try {
      await api.setBookRequestCompleted(token, id, true)
      setRequests(prev => {
        const req = prev.find(r => r.id === id)
        if (req) setCompletedRequests(c => [{ ...req, completed: true }, ...c])
        return prev.filter(r => r.id !== id)
      })
    } catch {
      setError('failed to update request')
    }
  }

  function clearSearch() {
    setSearchQuery('')
    setSearchGenre('')
    setSearchResults(null)
  }

  const isSearchMode = searchResults !== null
  const selectedShelf = shelves.find(s => s.id === selectedShelfId) ?? null
  const displayedBooks = isSearchMode
    ? sortBooks(searchResults, sortBy)
    : sortBooks(books, sortBy)
  const bookCount = isSearchMode ? searchResults.length : books.length

  // Find my review in detail modal
  const myReview = detailReviews.find(r => r.reviewerId === myUserId)

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
              <div
                key={shelf.id}
                className={`${styles.shelfRow} ${dragOverShelfId === shelf.id ? styles.shelfDragOver : ''}`}
                onDragOver={e => { e.preventDefault(); setDragOverShelfId(shelf.id) }}
                onDragLeave={() => setDragOverShelfId(null)}
                onDrop={() => handleDrop(shelf.id)}
                onContextMenu={e => { e.preventDefault(); setShelfMenu({ shelf, x: e.clientX, y: e.clientY }) }}
              >
                <button
                  type="button"
                  className={`${styles.shelfBtn} ${shelf.id === selectedShelfId && !isSearchMode ? styles.shelfActive : ''}`}
                  onClick={() => { setSelectedShelfId(shelf.id); clearSearch() }}
                >
                  <span className={styles.shelfName}>{shelf.name}</span>
                  <span className={styles.shelfCount}>[{shelf._count.books}]</span>
                </button>
              </div>
            ))}
            {shelves.length === 0 && !creatingShelf && (
              <div className={styles.empty}>no shelves yet</div>
            )}
          </div>

          {/* Book requests */}
          <div className={styles.requestsBtn}>
            <button type="button" className={styles.requestsPanelBtn} onClick={openRequests}>
              book requests
            </button>
          </div>

          {/* Genre filter */}
          <div className={styles.genrePanel}>
            <div className={styles.panelTitle} style={{ padding: '8px 12px 4px' }}>genre</div>
            {GENRES.map(g => (
              <button
                key={g}
                type="button"
                className={`${styles.genreBtn} ${searchGenre === g ? styles.genreActive : ''}`}
                onClick={() => {
                  if (searchGenre === g) setSearchGenre('')
                  else { setSearchGenre(g); setSelectedShelfId(null) }
                }}
              >
                {g}
              </button>
            ))}
          </div>
        </aside>

        {/* Right panel: books */}
        <main className={styles.bookPanel}>
          <div className={styles.bookHeader}>
            <div className={styles.headerLeft}>
              <span className={styles.libraryTitle}>THE LIBRARY</span>
              {isSearchMode
                ? <span className={styles.shelfLabel}>/ search results ({bookCount})</span>
                : selectedShelf && (
                  <>
                    <span className={styles.shelfLabel}>/ {selectedShelf.name}</span>
                    {selectedShelf.description && (
                      <span className={styles.shelfDescription}>{selectedShelf.description}</span>
                    )}
                  </>
                )
              }
            </div>
            <div className={styles.headerRight}>
              {/* Search input */}
              <div className={styles.searchWrap}>
                <input
                  type="text"
                  className={styles.searchInput}
                  placeholder="search title, author, series..."
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); if (!e.target.value && !searchGenre) clearSearch() }}
                />
                {(searchQuery || searchGenre) && (
                  <button type="button" className={styles.searchClear} onClick={clearSearch}>[x]</button>
                )}
              </div>
              {bookCount > 1 && (
                <div className={styles.sortBar}>
                  <span className={styles.sortLabel}>sort:</span>
                  {(['title', 'author', 'series'] as SortKey[]).map(k => (
                    <button
                      key={k}
                      type="button"
                      className={`${styles.sortBtn} ${sortBy === k ? styles.sortActive : ''}`}
                      onClick={() => setSortBy(k)}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              )}
              {selectedShelfId && !isSearchMode && (
                <button type="button" className={styles.iconBtn} onClick={() => setUploadOpen(true)}>
                  [+ add book]
                </button>
              )}
            </div>
          </div>

          {(loadingBooks || searching) && <div className={styles.loading}>loading...</div>}

          {!loadingBooks && !searching && !isSearchMode && selectedShelfId && books.length === 0 && (
            <div className={styles.empty}>no books on this shelf yet — add one with [+ add book]</div>
          )}

          {!loadingBooks && !searching && isSearchMode && searchResults.length === 0 && (
            <div className={styles.empty}>no results</div>
          )}

          {!selectedShelfId && !isSearchMode && (
            <div className={styles.empty}>select or create a shelf to get started</div>
          )}

          <div className={styles.bookGrid}>
            {displayedBooks.map(book => (
              <div
                key={book.id}
                className={`${styles.bookCard} ${dragBookId === book.id ? styles.bookDragging : ''}`}
                draggable
                onDragStart={() => {
                  setDragBookId(book.id)
                  setDragSourceShelfId(book.shelf?.id ?? selectedShelfId)
                }}
                onDragEnd={() => { setDragBookId(null); setDragSourceShelfId(null); setDragOverShelfId(null) }}
                onContextMenu={e => { e.preventDefault(); setBookMenu({ book, x: e.clientX, y: e.clientY }) }}
              >
                <button
                  type="button"
                  className={styles.bookCoverBtn}
                  onClick={() => openBookDetail(book)}
                  title={`view ${book.title}`}
                >
                  {book.coverUrl
                    ? <img src={book.coverUrl.startsWith('http') ? book.coverUrl : resolveAttachmentUrl(book.coverUrl)} alt={book.title} className={styles.bookCover} />
                    : (
                      <div className={styles.bookCoverPlaceholder}>
                        <span className={styles.mimeLabel}>{mimeLabel(book.mimeType)}</span>
                      </div>
                    )}
                </button>
                <div className={styles.bookMeta}>
                  <div className={styles.bookTitle}>{book.title}</div>
                  {book.author && <div className={styles.bookSub}>{book.author}</div>}
                  {book.series && <div className={styles.bookSub}><em>{book.series}</em></div>}
                  {book.genre && <div className={styles.bookGenreTag}>{book.genre}</div>}
                  {isSearchMode && book.shelf && (
                    <div className={styles.bookSub} title="shelf">{book.shelf.name}</div>
                  )}
                  <div className={styles.bookSub}>{mimeLabel(book.mimeType)} · {formatSize(book.size)}</div>
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>

      {/* Shelf context menu */}
      {shelfMenu && (
        <ContextMenu
          x={shelfMenu.x}
          y={shelfMenu.y}
          onClose={() => setShelfMenu(null)}
          items={[
            { label: 'edit shelf', action: () => openEditShelf(shelfMenu.shelf) },
            { label: 'copy link', action: () => { void navigator.clipboard.writeText(`[[shelf:${shelfMenu.shelf.id}]]`); setShelfMenu(null) } },
            {
              label: shelfMenu.shelf._count.books > 0
                ? `delete (remove all ${shelfMenu.shelf._count.books} book${shelfMenu.shelf._count.books === 1 ? '' : 's'} first)`
                : 'delete shelf',
              danger: shelfMenu.shelf._count.books === 0,
              disabled: shelfMenu.shelf._count.books > 0,
              action: () => { handleDeleteShelf(shelfMenu.shelf.id); setShelfMenu(null) },
            },
          ] satisfies ContextMenuItem[]}
        />
      )}

      {/* Book context menu */}
      {bookMenu && (
        <ContextMenu
          x={bookMenu.x}
          y={bookMenu.y}
          onClose={() => setBookMenu(null)}
          items={[
            { label: 'view / review', action: () => { void openBookDetail(bookMenu.book); setBookMenu(null) } },
            { label: 'edit', action: () => openEditBook(bookMenu.book) },
            { label: 'copy link', action: () => { void navigator.clipboard.writeText(`[[book:${bookMenu.book.id}]]`); setBookMenu(null) } },
            { label: 'delete', danger: true, action: () => openDeleteBookConfirm(bookMenu.book) },
          ] satisfies ContextMenuItem[]}
        />
      )}

      {/* Book detail modal */}
      {detailBook && (
        <div className={styles.modalOverlay} onClick={e => e.target === e.currentTarget && closeBookDetail()}>
          <div className={styles.bookDetailModal}>
            <div className={styles.bookDetailHeader}>
              <span className={styles.bookDetailTitle}>{detailBook.title}</span>
              <div className={styles.bookDetailHeaderRight}>
                <a
                  href={resolveAttachmentUrl(`/uploads/${detailBook.storedName}`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.downloadLink}
                >
                  [download]
                </a>
                <button type="button" className={styles.iconBtn} onClick={closeBookDetail}>[x]</button>
              </div>
            </div>

            <div className={styles.bookDetailBody}>
              {/* Cover */}
              <div className={styles.bookDetailCover}>
                {detailBook.coverUrl
                  ? <img
                      src={detailBook.coverUrl.startsWith('http') ? detailBook.coverUrl : resolveAttachmentUrl(detailBook.coverUrl)}
                      alt={detailBook.title}
                      className={styles.bookDetailCoverImg}
                    />
                  : (
                    <div className={styles.bookDetailCoverPlaceholder}>
                      <span className={styles.mimeLabel}>{mimeLabel(detailBook.mimeType)}</span>
                    </div>
                  )}
              </div>

              {/* Info + reviews */}
              <div className={styles.bookDetailInfo}>
                {detailBook.author && <div className={styles.bookDetailAuthor}>{detailBook.author}</div>}
                {detailBook.series && <div className={styles.bookDetailSeries}>{detailBook.series}</div>}

                <div className={styles.bookDetailStats}>
                  {detailBook.genre && (
                    <div className={styles.statRow}>
                      <span className={styles.statLabel}>genre</span>
                      <span className={styles.statValue}>{detailBook.genre}</span>
                    </div>
                  )}
                  <div className={styles.statRow}>
                    <span className={styles.statLabel}>format</span>
                    <span className={styles.statValue}>{mimeLabel(detailBook.mimeType)} · {formatSize(detailBook.size)}</span>
                  </div>
                  {detailBook.shelf && (
                    <div className={styles.statRow}>
                      <span className={styles.statLabel}>shelf</span>
                      <span className={styles.statValue}>{detailBook.shelf.name}</span>
                    </div>
                  )}
                  <div className={styles.statRow}>
                    <span className={styles.statLabel}>added by</span>
                    <span className={styles.statValue}>{detailBook.uploader.displayName} · {formatRelativeDate(detailBook.uploadedAt)}</span>
                  </div>
                  <div className={styles.statRow}>
                    <span className={styles.statLabel}>rating</span>
                    <span className={styles.statValue}>
                      {detailAvgRating !== null
                        ? <><Stars value={detailAvgRating} /> <span className={styles.ratingNum}>{detailAvgRating.toFixed(1)} / 5</span> <span className={styles.ratingCount}>({detailReviewCount})</span></>
                        : <span className={styles.statMuted}>no reviews yet</span>
                      }
                    </span>
                  </div>
                </div>

                {detailLoading && <div className={styles.reviewsLoading}>loading reviews...</div>}

                {!detailLoading && (
                  <>
                    {/* Review list */}
                    {detailReviews.length > 0 && (
                      <div className={styles.reviewList}>
                        <div className={styles.reviewListTitle}>reviews ({detailReviewCount})</div>
                        {detailReviews.map(r => (
                          <div key={r.id} className={`${styles.reviewItem} ${r.reviewerId === myUserId ? styles.reviewMine : ''}`}>
                            <div className={styles.reviewItemHeader}>
                              <Stars value={r.rating} />
                              <span className={styles.reviewerName}>{r.reviewer.displayName}</span>
                              {r.reviewerId === myUserId && <span className={styles.reviewYouTag}>[you]</span>}
                              <span className={styles.reviewDate}>{formatRelativeDate(r.createdAt)}</span>
                            </div>
                            {r.comment && <div className={styles.reviewComment}>{r.comment}</div>}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Review form */}
                    <form onSubmit={handleSubmitReview} className={styles.reviewForm}>
                      <div className={styles.reviewFormTitle}>
                        {myReview ? 'update your review' : 'leave a review'}
                      </div>
                      <div className={styles.reviewFormRow}>
                        <StarPicker value={reviewRating} onChange={setReviewRating} />
                        {reviewRating > 0 && <span className={styles.ratingNum}>{reviewRating} / 5</span>}
                      </div>
                      <textarea
                        className={styles.reviewTextarea}
                        placeholder="comment (optional)"
                        value={reviewComment}
                        onChange={e => setReviewComment(e.target.value)}
                        rows={3}
                      />
                      <div className={styles.formActions}>
                        <button
                          type="submit"
                          className={styles.submitBtn}
                          disabled={reviewRating < 1 || submittingReview}
                        >
                          {submittingReview ? 'submitting...' : myReview ? '[update]' : '[submit]'}
                        </button>
                      </div>
                    </form>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete book confirm modal */}
      {deleteBookConfirm && (
        <div className={styles.modalOverlay} onClick={e => e.target === e.currentTarget && (setDeleteBookConfirm(null), setDeleteBookInput(''))}>
          <div className={styles.modal}>
            <div className={styles.modalTitle}>delete book</div>
            <p className={styles.deleteWarning}>
              this cannot be undone. type <span className={styles.deleteTarget}>{deleteBookConfirm.title}</span> to confirm.
            </p>
            <form onSubmit={e => { e.preventDefault(); if (deleteBookInput === deleteBookConfirm.title) handleDeleteBook() }} className={styles.uploadForm}>
              <input
                autoFocus
                className={styles.formInput}
                placeholder={deleteBookConfirm.title}
                value={deleteBookInput}
                onChange={e => setDeleteBookInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') { setDeleteBookConfirm(null); setDeleteBookInput('') } }}
              />
              <div className={styles.formActions}>
                <button type="submit" className={styles.dangerBtn} disabled={deleteBookInput !== deleteBookConfirm.title}>
                  [delete]
                </button>
                <button type="button" className={styles.cancelBtn} onClick={() => { setDeleteBookConfirm(null); setDeleteBookInput('') }}>
                  [cancel]
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit shelf modal */}
      {editingShelf && (
        <div className={styles.modalOverlay} onClick={e => e.target === e.currentTarget && closeEditShelf()}>
          <div className={styles.modal}>
            <div className={styles.modalTitle}>edit shelf</div>
            <form onSubmit={handleSaveShelf} className={styles.uploadForm}>
              <label className={styles.formLabel}>
                name
                <input
                  autoFocus
                  type="text"
                  value={editShelfName}
                  onChange={e => setEditShelfName(e.target.value)}
                  className={styles.formInput}
                  onKeyDown={e => { if (e.key === 'Escape') closeEditShelf() }}
                />
              </label>
              <label className={styles.formLabel}>
                description
                <input
                  type="text"
                  value={editShelfDescription}
                  onChange={e => setEditShelfDescription(e.target.value)}
                  placeholder="optional description..."
                  className={styles.formInput}
                  onKeyDown={e => { if (e.key === 'Escape') closeEditShelf() }}
                />
              </label>
              <div className={styles.formActions}>
                <button type="submit" className={styles.submitBtn} disabled={savingShelf || !editShelfName.trim()}>
                  {savingShelf ? 'saving...' : '[save]'}
                </button>
                <button type="button" className={styles.cancelBtn} onClick={closeEditShelf}>
                  [cancel]
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit book modal */}
      {editBook && (
        <div className={styles.modalOverlay} onClick={e => e.target === e.currentTarget && closeEditBook()}>
          <div className={styles.modal}>
            <div className={styles.modalTitle}>edit "{editBook.title}"</div>
            <form onSubmit={handleSaveEdit} className={styles.uploadForm}>
              <label className={styles.formLabel}>
                title
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className={styles.formInput}
                  autoFocus
                />
              </label>

              <label className={styles.formLabel}>
                author
                <input
                  type="text"
                  value={editAuthor}
                  onChange={e => setEditAuthor(e.target.value)}
                  placeholder="author name"
                  className={styles.formInput}
                />
              </label>

              <label className={styles.formLabel}>
                series
                <input
                  type="text"
                  value={editSeries}
                  onChange={e => setEditSeries(e.target.value)}
                  placeholder="series name"
                  className={styles.formInput}
                />
              </label>

              <label className={styles.formLabel}>
                genre
                <div className={styles.genreRadios}>
                  {GENRES.map(g => (
                    <label key={g} className={styles.genreRadio}>
                      <input
                        type="radio"
                        name="editGenre"
                        value={g}
                        checked={editGenre === g}
                        onChange={() => setEditGenre(g)}
                      />
                      {g}
                    </label>
                  ))}
                  <label className={styles.genreRadio}>
                    <input
                      type="radio"
                      name="editGenre"
                      value=""
                      checked={editGenre === ''}
                      onChange={() => setEditGenre('')}
                    />
                    none
                  </label>
                </div>
              </label>

              <label className={styles.formLabel}>
                cover image
                <button type="button" className={styles.filePickerBtn} onClick={() => editCoverInputRef.current?.click()}>
                  {editCoverFile ? editCoverFile.name : '[choose file]'}
                </button>
                <input
                  ref={editCoverInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  style={{ display: 'none' }}
                  onChange={e => { setEditCoverFile(e.target.files?.[0] ?? null); setEditCoverUrl('') }}
                />
              </label>

              <label className={styles.formLabel}>
                — or cover URL
                <input
                  type="url"
                  value={editCoverUrl}
                  onChange={e => { setEditCoverUrl(e.target.value); setEditCoverFile(null) }}
                  placeholder="https://..."
                  className={styles.formInput}
                  disabled={!!editCoverFile}
                />
              </label>

              <div className={styles.formActions}>
                <button type="submit" className={styles.submitBtn} disabled={saving}>
                  {saving ? 'saving...' : '[save]'}
                </button>
                <button type="button" className={styles.cancelBtn} onClick={closeEditBook}>
                  [cancel]
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Book requests modal */}
      {requestsOpen && (
        <div className={styles.modalOverlay} onClick={e => e.target === e.currentTarget && setRequestsOpen(false)}>
          <div className={styles.modal}>
            <div className={styles.modalTitle}>
              book requests
              <button type="button" className={styles.iconBtn} style={{ float: 'right' }} onClick={() => setRequestsOpen(false)}>[x]</button>
            </div>

            {requestsLoading && <div className={styles.loading}>loading...</div>}

            {!requestsLoading && (
              <>
                {requests.length === 0 && (
                  <div className={styles.empty} style={{ padding: '8px 0' }}>no open requests</div>
                )}
                <div className={styles.requestList}>
                  {requests.map(r => (
                    <div key={r.id} className={styles.requestItem}>
                      <div className={styles.requestItemMain}>
                        <span className={styles.requestTitle}>{r.title}</span>
                        {r.author && <span className={styles.requestAuthor}> — {r.author}</span>}
                      </div>
                      <div className={styles.requestItemMeta}>
                        <span className={styles.requestRequester}>requested by {r.requester.displayName}</span>
                        <span className={styles.requestDate}>{formatRelativeDate(r.requestedAt)}</span>
                        {r.notes && <div className={styles.requestNotes}>{r.notes}</div>}
                      </div>
                      <button type="button" className={styles.completeBtn} onClick={() => handleCompleteRequest(r.id)}>
                        [mark fulfilled]
                      </button>
                    </div>
                  ))}
                </div>

                <div className={styles.requestToggle}>
                  <button type="button" className={styles.iconBtn} onClick={() => setShowCompleted(v => !v)}>
                    {showCompleted ? '▾' : '▸'} historical requests ({completedRequests.length})
                  </button>
                </div>

                {showCompleted && (
                  <div className={styles.requestList}>
                    {completedRequests.map(r => (
                      <div key={r.id} className={`${styles.requestItem} ${styles.requestCompleted}`}>
                        <div className={styles.requestItemMain}>
                          <span className={styles.requestTitle}>{r.title}</span>
                          {r.author && <span className={styles.requestAuthor}> — {r.author}</span>}
                        </div>
                        <div className={styles.requestItemMeta}>
                          <span className={styles.requestRequester}>requested by {r.requester.displayName}</span>
                          <span className={styles.requestDate}>{formatRelativeDate(r.requestedAt)}</span>
                        </div>
                      </div>
                    ))}
                    {completedRequests.length === 0 && (
                      <div className={styles.empty} style={{ padding: '4px 0' }}>none yet</div>
                    )}
                  </div>
                )}

                <form onSubmit={handleSubmitRequest} className={styles.requestForm}>
                  <div className={styles.reviewFormTitle}>request a book</div>
                  <input
                    type="text"
                    className={styles.formInput}
                    placeholder="title *"
                    value={newRequestTitle}
                    onChange={e => setNewRequestTitle(e.target.value)}
                  />
                  <input
                    type="text"
                    className={styles.formInput}
                    placeholder="author (optional)"
                    value={newRequestAuthor}
                    onChange={e => setNewRequestAuthor(e.target.value)}
                  />
                  <textarea
                    className={styles.reviewTextarea}
                    placeholder="notes (optional)"
                    value={newRequestNotes}
                    onChange={e => setNewRequestNotes(e.target.value)}
                    rows={2}
                  />
                  <div className={styles.formActions}>
                    <button type="submit" className={styles.submitBtn} disabled={!newRequestTitle.trim() || submittingRequest}>
                      {submittingRequest ? 'submitting...' : '[submit request]'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

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
                author (optional)
                <input
                  type="text"
                  value={uploadAuthor}
                  onChange={e => setUploadAuthor(e.target.value)}
                  placeholder="author name"
                  className={styles.formInput}
                />
              </label>

              <label className={styles.formLabel}>
                series (optional)
                <input
                  type="text"
                  value={uploadSeries}
                  onChange={e => setUploadSeries(e.target.value)}
                  placeholder="series name"
                  className={styles.formInput}
                />
              </label>

              <label className={styles.formLabel}>
                genre
                <div className={styles.genreRadios}>
                  {GENRES.map(g => (
                    <label key={g} className={styles.genreRadio}>
                      <input
                        type="radio"
                        name="genre"
                        value={g}
                        checked={uploadGenre === g}
                        onChange={() => setUploadGenre(g)}
                      />
                      {g}
                    </label>
                  ))}
                  <label className={styles.genreRadio}>
                    <input
                      type="radio"
                      name="genre"
                      value=""
                      checked={uploadGenre === ''}
                      onChange={() => setUploadGenre('')}
                    />
                    none
                  </label>
                </div>
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
                  onChange={e => { setUploadCover(e.target.files?.[0] ?? null); setUploadCoverUrl('') }}
                />
              </label>

              <label className={styles.formLabel}>
                — or cover URL
                <input
                  type="url"
                  value={uploadCoverUrl}
                  onChange={e => { setUploadCoverUrl(e.target.value); setUploadCover(null) }}
                  placeholder="https://..."
                  className={styles.formInput}
                  disabled={!!uploadCover}
                />
              </label>

              <div className={styles.formActions}>
                <button type="submit" className={styles.submitBtn} disabled={!uploadFile || uploading}>
                  {uploading ? 'uploading...' : '[upload]'}
                </button>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => {
                    setUploadOpen(false)
                    setUploadFile(null)
                    setUploadCover(null)
                    setUploadCoverUrl('')
                    setUploadTitle('')
                    setUploadAuthor('')
                    setUploadSeries('')
                    setUploadGenre('')
                  }}
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
