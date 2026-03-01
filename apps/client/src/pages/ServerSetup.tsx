import { useState } from 'react'
import { setServerUrl } from '../lib/config.ts'
import styles from './Login.module.css'

interface Props {
  onConfigured: () => void
}

export default function ServerSetup({ onConfigured }: Props) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = url.trim()
    if (!trimmed) return
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      setError('URL must start with http:// or https://')
      return
    }
    setServerUrl(trimmed)
    onConfigured()
  }

  return (
    <div className={styles.root}>
      <div className={styles.box}>
        <h1 className={styles.title}>GANDER</h1>
        <p className={styles.subtitle}>connect to a server</p>
        <form onSubmit={submit} className={styles.form}>
          <input
            placeholder="http://your-server:3000"
            value={url}
            onChange={e => { setError(null); setUrl(e.target.value) }}
            required
            autoFocus
          />
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit">connect</button>
        </form>
      </div>
    </div>
  )
}
