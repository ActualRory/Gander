import { useEffect, useState } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { openUrl } from '@tauri-apps/plugin-opener'
import { platform } from './platform.ts'
import type { UpdaterState } from './useAppUpdater.ts'

const RELEASES_API = 'https://api.github.com/repos/ActualRory/Gander/releases/latest'
const RELEASES_PAGE = 'https://github.com/ActualRory/Gander/releases/latest'

function semverGt(a: string, b: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number)
  const [aMaj, aMin, aPatch] = parse(a)
  const [bMaj, bMin, bPatch] = parse(b)
  if (aMaj !== bMaj) return aMaj > bMaj
  if (aMin !== bMin) return aMin > bMin
  return aPatch > bPatch
}

export function useAndroidUpdateCheck() {
  const [state, setState] = useState<UpdaterState>({ phase: 'idle' })
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!platform.hasInAppUpdateCheck) return
    let cancelled = false
    async function check() {
      try {
        const current = await getVersion()
        const res = await fetch(RELEASES_API)
        if (!res.ok) return
        const data = await res.json()
        const latest = (data.tag_name ?? '').replace(/^v/, '')
        if (!cancelled && semverGt(latest, current)) {
          setState({ phase: 'available', version: latest })
        }
      } catch {
        // silent — update check failures must never surface to users
      }
    }
    check()
    return () => { cancelled = true }
  }, [])

  async function install() {
    // Open releases page — user taps the APK link from there
    await openUrl(RELEASES_PAGE)
  }

  function dismiss() { setDismissed(true) }
  function show() { setDismissed(false) }

  const hasUpdate = state.phase === 'available'
  const visible = !dismissed && hasUpdate
  return { state, visible, hasUpdate, install, dismiss, show }
}
