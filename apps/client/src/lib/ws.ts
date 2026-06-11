import type { ServerEvent, ClientEvent } from '@gander/shared'
import { getServerUrl } from './config.ts'

type EventHandler = (event: ServerEvent) => void

export type ConnectionStatus = 'connecting' | 'online' | 'offline'

export class GanderWS {
  private ws: WebSocket | null = null
  private handlers = new Set<EventHandler>()
  private reconnectHandlers = new Set<() => void>()
  private statusHandlers = new Set<(status: ConnectionStatus) => void>()
  private authFailHandler: (() => void) | null = null
  private authed = false
  private queue: ClientEvent[] = []
  private dead = false
  private hasConnectedOnce = false
  private token: string
  private wsUrl: string
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  status: ConnectionStatus = 'connecting'

  constructor(token: string) {
    const base = getServerUrl() ?? import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
    this.wsUrl = base.replace(/^http/, 'ws') + '/ws'
    this.token = token
    this.connect()
  }

  private setStatus(status: ConnectionStatus) {
    if (this.status === status) return
    this.status = status
    for (const cb of this.statusHandlers) cb(status)
  }

  private connect() {
    this.setStatus('connecting')
    const ws = new WebSocket(this.wsUrl)
    this.ws = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token: this.token }))
      this.authed = true
      this.setStatus('online')
      for (const event of this.queue) {
        ws.send(JSON.stringify(event))
      }
      this.queue = []
      if (this.hasConnectedOnce) {
        for (const cb of this.reconnectHandlers) cb()
      }
      this.hasConnectedOnce = true
    }

    ws.onmessage = (e: MessageEvent<string>) => {
      const event = JSON.parse(e.data) as ServerEvent
      for (const handler of this.handlers) handler(event)
    }

    ws.onerror = () => {
      // onclose will fire after onerror and handle reconnect
    }

    ws.onclose = (e: CloseEvent) => {
      this.authed = false
      this.ws = null
      this.setStatus('offline')
      // 4001 = bad/expired token, 4003 = banned — reconnecting won't help
      if (e.code === 4001 || e.code === 4003) {
        this.dead = true
        this.authFailHandler?.()
        return
      }
      if (!this.dead) {
        this.reconnectTimer = setTimeout(() => this.connect(), 3000)
      }
    }
  }

  /**
   * Reconnect immediately if not currently connected. Used when the app
   * resumes from background or the network comes back — background timers
   * are throttled on mobile, so the 3s retry loop may be stalled.
   */
  forceReconnect() {
    if (this.dead) return
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.connect()
  }

  send(event: ClientEvent) {
    if (this.authed && this.ws) {
      this.ws.send(JSON.stringify(event))
    } else {
      this.queue.push(event)
    }
  }

  on(handler: EventHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  onReconnect(cb: () => void): () => void {
    this.reconnectHandlers.add(cb)
    return () => this.reconnectHandlers.delete(cb)
  }

  onStatus(cb: (status: ConnectionStatus) => void): () => void {
    this.statusHandlers.add(cb)
    return () => this.statusHandlers.delete(cb)
  }

  onAuthFail(cb: () => void) {
    this.authFailHandler = cb
  }

  close() {
    this.dead = true
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer)
    this.reconnectHandlers.clear()
    this.statusHandlers.clear()
    this.ws?.close()
  }
}
