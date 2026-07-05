import { useEffect, useState } from 'react'

// The breakpoint used by all mobile-layout CSS. Keep in sync with the
// @media (max-width: 640px) blocks in the CSS modules.
export const MOBILE_LAYOUT = '(max-width: 640px)'

// For JS behavior that must fork on the same breakpoint the CSS uses
// (drawer gestures, sheet menus). Native feature availability stays in platform.ts.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [query])

  return matches
}
