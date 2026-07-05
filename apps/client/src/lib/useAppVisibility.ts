import { useEffect, useState } from 'react'

// Document visibility as the "is the user looking at the app" signal.
// On Android the tao window focus event never fires, so visibilitychange
// is the only reliable attention signal there; on desktop it supplements focus.

export function isAppVisible(): boolean {
  return document.visibilityState === 'visible'
}

export function useAppVisibility(): boolean {
  const [visible, setVisible] = useState(isAppVisible)

  useEffect(() => {
    const handler = () => setVisible(isAppVisible())
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  return visible
}
