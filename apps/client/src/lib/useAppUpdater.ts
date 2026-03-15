import { useEffect, useRef, useState } from 'react'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { platform } from './platform.ts'

export type UpdaterState =
  | { phase: 'idle' }
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; progress: number | null }
  | { phase: 'ready' }
  | { phase: 'error'; message: string }

export function useAppUpdater() {
  const [state, setState] = useState<UpdaterState>({ phase: 'idle' })
  const [dismissed, setDismissed] = useState(false)
  const updateRef = useRef<Update | null>(null)

  useEffect(() => {
    if (!platform.hasUpdater) return

    let cancelled = false

    check()
      .then(update => {
        if (cancelled || !update?.available) return
        updateRef.current = update
        setState({ phase: 'available', version: update.version })
      })
      .catch(err => {
        if (cancelled) return
        console.warn('[updater] check failed:', err, JSON.stringify(err))
      })

    return () => { cancelled = true }
  }, [])

  async function install() {
    if (!platform.hasUpdater) return
    const update = updateRef.current
    if (!update) return

    setState({ phase: 'downloading', progress: null })

    try {
      let downloaded = 0
      let total: number | null = null

      await update.downloadAndInstall(event => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? null
          setState({ phase: 'downloading', progress: total ? 0 : null })
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength
          setState({
            phase: 'downloading',
            progress: total ? Math.round((downloaded / total) * 100) : null,
          })
        } else if (event.event === 'Finished') {
          setState({ phase: 'ready' })
        }
      })

      await relaunch()
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  function dismiss() {
    setDismissed(true)
  }

  const visible =
    !dismissed &&
    (state.phase === 'available' ||
      state.phase === 'downloading' ||
      state.phase === 'ready' ||
      state.phase === 'error')

  return { state, visible, install, dismiss }
}
