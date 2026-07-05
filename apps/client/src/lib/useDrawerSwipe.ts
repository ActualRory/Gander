import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

interface DrawerSwipeOptions {
  side: 'left' | 'right'
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
  drawerRef: RefObject<HTMLElement | null>
  enabled: boolean
}

const EDGE_ZONE = 24 // px from the screen edge that starts an open gesture
const DRAG_THRESHOLD = 12 // horizontal px before the drag claims the gesture
const CANCEL_VERTICAL = 24 // vertical px that hands the gesture to scrolling
const COMMIT_DISTANCE = 70 // px dragged to commit open/close
const COMMIT_VELOCITY = 0.3 // px/ms flick that commits regardless of distance

// Edge-swipe open / swipe close for the mobile drawers (Sidebar left,
// SocialPanel right). Only ever touches inline styles during an active drag —
// the CSS `.open` class stays the source of truth, so the hook is a no-op for
// mouse input and when `enabled` is false (desktop layout).
export function useDrawerSwipe(options: DrawerSwipeOptions) {
  const optsRef = useRef(options)
  useEffect(() => { optsRef.current = options })

  useEffect(() => {
    if (!options.enabled) return

    let tracking = false
    let dragging = false
    let opening = false
    let startX = 0
    let startY = 0
    let width = 0
    let samples: Array<{ x: number; t: number }> = []

    const drawerEl = () => optsRef.current.drawerRef.current

    function onPointerDown(e: PointerEvent) {
      if (e.pointerType !== 'touch' || tracking) return
      const { side, isOpen } = optsRef.current
      if (!drawerEl()) return
      if (!isOpen) {
        const nearEdge = side === 'left'
          ? e.clientX <= EDGE_ZONE
          : e.clientX >= window.innerWidth - EDGE_ZONE
        if (!nearEdge) return
        opening = true
      } else {
        opening = false
      }
      tracking = true
      dragging = false
      startX = e.clientX
      startY = e.clientY
      samples = [{ x: e.clientX, t: e.timeStamp }]
    }

    function onPointerMove(e: PointerEvent) {
      if (!tracking) return
      const { side } = optsRef.current
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      samples.push({ x: e.clientX, t: e.timeStamp })
      if (samples.length > 6) samples.shift()

      if (!dragging) {
        if (Math.abs(dy) > CANCEL_VERTICAL && Math.abs(dy) > Math.abs(dx)) {
          tracking = false // vertical scroll wins
          return
        }
        const toward = opening
          ? (side === 'left' ? dx > DRAG_THRESHOLD : dx < -DRAG_THRESHOLD)
          : (side === 'left' ? dx < -DRAG_THRESHOLD : dx > DRAG_THRESHOLD)
        if (!toward) return
        dragging = true
        const el = drawerEl()
        if (el) {
          width = el.offsetWidth
          el.style.transition = 'none'
        }
      }

      const el = drawerEl()
      if (!el) return
      let offset: number
      if (side === 'left') {
        offset = opening
          ? Math.min(0, -width + dx)
          : Math.min(0, Math.max(-width, dx))
      } else {
        offset = opening
          ? Math.max(0, width + dx)
          : Math.max(0, Math.min(width, dx))
      }
      el.style.transform = `translateX(${offset}px)`
    }

    function settle(commit: boolean) {
      const { onOpen, onClose } = optsRef.current
      const el = drawerEl()
      if (commit) (opening ? onOpen : onClose)()
      // Clear inline styles only after React has applied/removed the .open
      // class, so the drawer animates from the dragged position to its
      // resting place instead of snapping back first.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (el) {
          el.style.transition = ''
          el.style.transform = ''
        }
      }))
    }

    function onPointerUp(e: PointerEvent) {
      if (!tracking) return
      tracking = false
      if (!dragging) return
      dragging = false
      const { side } = optsRef.current
      const dx = e.clientX - startX
      const first = samples[0]
      const dt = e.timeStamp - first.t
      const velocity = dt > 0 ? (e.clientX - first.x) / dt : 0
      const dir = opening
        ? (side === 'left' ? 1 : -1)
        : (side === 'left' ? -1 : 1)
      const commit = dx * dir >= COMMIT_DISTANCE || velocity * dir >= COMMIT_VELOCITY
      settle(commit)
    }

    function onPointerCancel() {
      if (!tracking) return
      tracking = false
      if (dragging) {
        dragging = false
        settle(false)
      }
    }

    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', onPointerCancel, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', onPointerCancel, true)
    }
  }, [options.enabled])
}
