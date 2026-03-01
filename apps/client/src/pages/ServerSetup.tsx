import { useEffect, useState } from 'react'
import { setServerUrl } from '../lib/config.ts'
import styles from './Login.module.css'

interface Props {
  onConfigured: () => void
  bootClearing: boolean
}

export default function ServerSetup({ onConfigured, bootClearing }: Props) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [dots, setDots] = useState('.')

  useEffect(() => {
    if (bootClearing) return
    const interval = setInterval(() => {
      setDots(d => d.length >= 3 ? '.' : d + '.')
    }, 400)
    return () => clearInterval(interval)
  }, [bootClearing])

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
        <p
          className={styles.booting}
          style={{ opacity: bootClearing ? 0 : 1 }}
        >
          Booting{dots}
        </p>
        <h1 className={styles.title}>GANDER</h1>
        <p
          className={styles.subtitle}
          style={{
            opacity: bootClearing ? 1 : 0,
            transition: bootClearing ? 'opacity 0.8s ease-in 0.4s' : 'none',
          }}
        >
          connect to a server
        </p>
        <form
          onSubmit={submit}
          className={styles.form}
          style={{
            opacity: bootClearing ? 1 : 0,
            transition: bootClearing ? 'opacity 0.8s ease-in 0.5s' : 'none',
          }}
        >
          <input
            placeholder="http://your-server:3000"
            value={url}
            onChange={e => { setError(null); setUrl(e.target.value) }}
            required
            autoFocus={bootClearing}
          />
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit">connect</button>
        </form>
      </div>
    </div>
  )
}
