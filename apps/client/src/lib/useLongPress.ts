import { useRef } from 'react'

// Fires callback after holding pointer down for `ms` milliseconds.
// Returns handlers to spread onto the target element alongside onContextMenu.
export function useLongPress(callback: (x: number, y: number) => void, ms = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function cancel() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  return {
    onPointerDown: (e: React.PointerEvent) => {
      const { clientX, clientY } = e
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        callback(clientX, clientY)
      }, ms)
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
  }
}
