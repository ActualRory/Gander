// Single source of truth for platform detection.
// Evaluated once at module load — never changes at runtime.
// Rule: use CSS @media (pointer: coarse) / @media (max-width: 640px) for layout;
//       use this module only for native feature availability.

const isTauri = typeof (window as any).__TAURI_INTERNALS__ !== 'undefined'
const isAndroid = isTauri && /android/i.test(navigator.userAgent)

export const platform = {
  isTauri,
  isDesktop: isTauri && !isAndroid,
  isMobile: isAndroid,
  isTouch: window.matchMedia('(pointer: coarse)').matches,
  // Native feature flags — gate Tauri API calls behind these
  hasUpdater: isTauri && !isAndroid,
  hasWindowBadge: isTauri && !isAndroid,
  hasCloseEvent: isTauri && !isAndroid,
  hasTray: isTauri && !isAndroid,
  hasInAppUpdateCheck: isTauri && isAndroid,
} as const
