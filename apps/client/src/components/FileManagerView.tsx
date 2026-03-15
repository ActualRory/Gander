import { useEffect, useState } from 'react'
import { api, resolveAttachmentUrl } from '../lib/api.ts'
import styles from './FileManagerView.module.css'

type SortField = 'uploadedAt' | 'size' | 'type' | 'uploader'

type FileEntry = {
  id: string
  filename: string
  mimeType: string
  size: number
  uploadedAt: string
  storedName: string
  uploader: { displayName: string }
  message: { channel: { id: string; name: string; type: string } } | null
}

type Stats = {
  totalSize: number
  fileCount: number
  byChannel: { channelId: string; channelName: string; fileCount: number; totalSize: number }[]
  limitBytes: number | null
}

interface Props {
  token: string
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function mimeShort(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'JPG',
    'image/png': 'PNG',
    'image/gif': 'GIF',
    'image/webp': 'WEBP',
    'application/pdf': 'PDF',
    'text/plain': 'TXT',
    'application/zip': 'ZIP',
    'application/x-zip-compressed': 'ZIP',
    'application/x-msdownload': 'EXE',
    'application/vnd.microsoft.portable-executable': 'EXE',
    'application/epub+zip': 'EPUB',
  }
  return map[mime] ?? mime.split('/')[1]?.toUpperCase().slice(0, 6) ?? '?'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function channelDisplayName(channel: { name: string; type: string }): string {
  if (channel.type === 'DM') {
    // name is "dm:userId1:userId2" — show as "DM"
    return 'DM'
  }
  if (channel.type === 'GROUP') return `group: ${channel.name}`
  return `#${channel.name}`
}

export default function FileManagerView({ token }: Props) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [sort, setSort] = useState<SortField>('uploadedAt')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [sort])

  async function loadData() {
    setLoading(true)
    try {
      const [filesRes, statsRes] = await Promise.all([
        api.getFileManagerFiles(token, { sort, limit: 500 }),
        api.getFileManagerStats(token),
      ])
      setFiles(filesRes.files)
      setStats(statsRes)
    } catch {
      setError('failed to load files')
    } finally {
      setLoading(false)
    }
  }

  // Group files by channel
  const grouped = files.reduce<Map<string, { label: string; files: FileEntry[] }>>((acc, f) => {
    const ch = f.message?.channel
    if (!ch) return acc
    const key = ch.id
    if (!acc.has(key)) acc.set(key, { label: channelDisplayName(ch), files: [] })
    acc.get(key)!.files.push(f)
    return acc
  }, new Map())

  const usagePct = stats && stats.limitBytes ? Math.min(100, (stats.totalSize / stats.limitBytes) * 100) : null

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>FILE MANAGER</span>
      </div>

      {error && (
        <div className={styles.errorBanner}>
          {error}
          <button type="button" onClick={() => setError(null)}>[x]</button>
        </div>
      )}

      {stats && (
        <div className={styles.storageSection}>
          <div className={styles.storageLabel}>
            {stats.limitBytes
              ? `storage: ${formatSize(stats.totalSize)} / ${formatSize(stats.limitBytes)} (${usagePct!.toFixed(1)}%)`
              : `storage: ${formatSize(stats.totalSize)} used`}
            <span className={styles.fileCount}> · {stats.fileCount} files</span>
          </div>
          {stats.limitBytes && (
            <div className={styles.storageBarTrack}>
              <div
                className={`${styles.storageBarFill} ${usagePct! > 85 ? styles.storageBarDanger : ''}`}
                style={{ width: `${usagePct}%` }}
              />
            </div>
          )}
        </div>
      )}

      <div className={styles.sortBar}>
        <span className={styles.sortLabel}>sort by:</span>
        {(['uploadedAt', 'size', 'type', 'uploader'] as SortField[]).map(f => (
          <button
            key={f}
            type="button"
            className={`${styles.sortBtn} ${sort === f ? styles.sortBtnActive : ''}`}
            onClick={() => setSort(f)}
          >
            {f === 'uploadedAt' ? 'date' : f}
            {sort === f && ' ▾'}
          </button>
        ))}
      </div>

      {loading && <div className={styles.loading}>loading...</div>}

      {!loading && files.length === 0 && (
        <div className={styles.empty}>no files found — upload files in any channel to see them here</div>
      )}

      <div className={styles.channelGroups}>
        {[...grouped.entries()].map(([channelId, group]) => {
          const channelStats = stats?.byChannel.find(c => c.channelId === channelId)
          return (
            <div key={channelId} className={styles.channelGroup}>
              <div className={styles.channelGroupHeader}>
                <span className={styles.channelGroupName}>{group.label}</span>
                <span className={styles.channelGroupMeta}>
                  {group.files.length} {group.files.length === 1 ? 'file' : 'files'}
                  {channelStats && ` · ${formatSize(channelStats.totalSize)}`}
                </span>
              </div>
              <table className={styles.fileTable}>
                <tbody>
                  {group.files.map(f => (
                    <tr key={f.id} className={styles.fileRow}>
                      <td className={styles.fileNameCell}>
                        <a
                          href={resolveAttachmentUrl(`/uploads/${f.storedName}`)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.fileLink}
                        >
                          {f.filename}
                        </a>
                      </td>
                      <td className={styles.fileTypeCell}>{mimeShort(f.mimeType)}</td>
                      <td className={styles.fileSizeCell}>{formatSize(f.size)}</td>
                      <td className={styles.fileUploaderCell}>{f.uploader.displayName}</td>
                      <td className={styles.fileDateCell}>{formatDate(f.uploadedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })}
      </div>
    </div>
  )
}
