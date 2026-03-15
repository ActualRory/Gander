import { useEffect, useRef, useState } from 'react'
import { api, resolveAttachmentUrl } from '../lib/api.ts'
import styles from './LibraryView.module.css'

type LibraryShelf = { id: string; name: string; createdAt: string; creatorId: string; _count: { books: number } }
type LibraryBook = {
  id: string; title: string; author: string | null; series: string | null; genre: string | null
  filename: string; storedName: string; mimeType: string; size: number
  coverUrl: string | null; uploadedAt: string; uploaderId: string
  uploader: { displayName: string }
  shelf?: { id: string; name: string }
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
    return av.localeCompare(bv)
  })
}

export default function LibraryView({ token }: Props) {
  const [shelves, setShelves] = useState<LibraryShelf[]>([])
  const [selectedShelfId, setSelectedShelfId] = useState<string | null>(null)
  const [books, setBooks] = useState<LibraryBook[]>([])
  const [loadingBooks, setLoadingBooks] = useState(false)
  const [sortBy, setSortBy] = useState<SortKey>('title')

  // Search mode
  const [searchQuery, setSearchQuery] = useState('')
  const [searchGenre, setSearchGenre] = useState<Genre | ''>('')
  const [searchResults, setSearchResults] = useState<LibraryBook[] | null>(null)
  const [searching, setSearching] = useState(false)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Shelf creation
  const [newShelfName, setNewShelfName] = useState('')
  const [creatingShelf, setCreatingShelf] = useState(false)

  // Shelf rename
  const [renamingShelfId, setRenamingShelfId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

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
  const [uploading, setUploading] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)

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

  async function handleRenameShelf(shelfId: string) {
    const name = renameValue.trim()
    if (!name) { cancelRename(); return }
    try {
      const updated = await api.renameLibraryShelf(token, shelfId, name) as LibraryShelf
      setShelves(prev => prev.map(s => s.id === shelfId ? { ...s, name: updated.name } : s))
    } catch {
      setError('failed to rename shelf')
    } finally {
      cancelRename()
    }
  }

  function startRename(shelf: LibraryShelf) {
    setRenamingShelfId(shelf.id)
    setRenameValue(shelf.name)
  }

  function cancelRename() {
    setRenamingShelfId(null)
    setRenameValue('')
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
      const book = await api.uploadLibraryBook(
        token, selectedShelfId, uploadFile, uploadTitle, uploadCover,
        uploadAuthor || undefined, uploadSeries || undefined, uploadGenre || undefined,
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleDeleteBook(bookId: string, shelfId?: string) {
    const targetShelfId = shelfId ?? selectedShelfId
    if (!targetShelfId) return
    try {
      await api.deleteLibraryBook(token, targetShelfId, bookId)
      setBooks(prev => prev.filter(b => b.id !== bookId))
      if (searchResults) setSearchResults(prev => prev?.filter(b => b.id !== bookId) ?? null)
      setShelves(prev => prev.map(s => s.id === targetShelfId
        ? { ...s, _count: { books: Math.max(0, s._count.books - 1) } }
        : s))
    } catch {
      setError('failed to delete book')
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
              >
                {renamingShelfId === shelf.id ? (
                  <form
                    className={styles.renameForm}
                    onSubmit={e => { e.preventDefault(); handleRenameShelf(shelf.id) }}
                  >
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Escape') cancelRename() }}
                      onBlur={() => handleRenameShelf(shelf.id)}
                      className={styles.renameInput}
                    />
                  </form>
                ) : (
                  <button
                    type="button"
                    className={`${styles.shelfBtn} ${shelf.id === selectedShelfId && !isSearchMode ? styles.shelfActive : ''}`}
                    onClick={() => { setSelectedShelfId(shelf.id); clearSearch() }}
                    onDoubleClick={() => startRename(shelf)}
                  >
                    <span className={styles.shelfName}>{shelf.name}</span>
                    <span className={styles.shelfCount}>[{shelf._count.books}]</span>
                  </button>
                )}
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
                : selectedShelf && <span className={styles.shelfLabel}>/ {selectedShelf.name}</span>
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
              >
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
                  {book.author && <div className={styles.bookSub}>{book.author}</div>}
                  {book.series && <div className={styles.bookSub}><em>{book.series}</em></div>}
                  {book.genre && <div className={styles.bookGenreTag}>{book.genre}</div>}
                  {isSearchMode && book.shelf && (
                    <div className={styles.bookSub} title="shelf">{book.shelf.name}</div>
                  )}
                  <div className={styles.bookSub}>{mimeLabel(book.mimeType)} · {formatSize(book.size)}</div>
                  <button
                    type="button"
                    className={styles.deleteBookBtn}
                    onClick={() => handleDeleteBook(book.id, book.shelf?.id ?? selectedShelfId ?? undefined)}
                  >
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
                  onClick={() => {
                    setUploadOpen(false)
                    setUploadFile(null)
                    setUploadCover(null)
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
