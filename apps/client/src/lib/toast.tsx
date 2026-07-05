import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import ToastStack, { type ToastItem, type ToastVariant } from '../components/Toast.tsx'

export interface ToastOptions {
  variant?: ToastVariant
  duration?: number
}

export type ToastFn = (message: string, options?: ToastOptions) => void

const ToastContext = createContext<ToastFn>(() => {})

const DEFAULT_DURATIONS: Record<ToastVariant, number> = {
  info: 5000,
  success: 5000,
  error: 8000,
}

const MAX_TOASTS = 4

// Module-level escape hatch for non-component code (ws callbacks, etc.).
// Prefer useToast() inside components.
type Emitter = (message: string, options?: ToastOptions) => void
let activeEmitter: Emitter | null = null
export function emitToast(message: string, options?: ToastOptions) {
  activeEmitter?.(message, options)
}

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const toast = useCallback<ToastFn>((message, options) => {
    const variant = options?.variant ?? 'info'
    const duration = options?.duration ?? DEFAULT_DURATIONS[variant]
    const id = nextId++
    setToasts(prev => [...prev.slice(-(MAX_TOASTS - 1)), { id, message, variant }])
    timers.current.set(id, setTimeout(() => dismiss(id), duration))
  }, [dismiss])

  useEffect(() => {
    activeEmitter = toast
    const currentTimers = timers.current
    return () => {
      if (activeEmitter === toast) activeEmitter = null
      for (const timer of currentTimers.values()) clearTimeout(timer)
    }
  }, [toast])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export function useToast(): ToastFn {
  return useContext(ToastContext)
}

// Normalize API errors into a friendly toast. api.ts throws Error(body.error),
// so permission failures arrive as their server message.
export function toastApiError(toast: ToastFn, err: unknown, fallback: string) {
  const message = err instanceof Error && err.message ? err.message : ''
  const isPermission = /permission|forbidden|must be a member|join required|invite-only/i.test(message)
  if (isPermission) {
    toast("you don't have permission to do that", { variant: 'error' })
  } else {
    toast(message ? `${fallback}: ${message}` : fallback, { variant: 'error' })
  }
}
