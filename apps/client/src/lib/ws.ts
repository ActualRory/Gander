import type { ServerEvent, ClientEvent } from '@gander/shared'
import { getServerUrl } from './config.ts'

type EventHandler = (event: ServerEvent) => void

export class GanderWS {
  private ws: WebSocket | null = null
  private handlers = new Set<EventHandler>()
  private authed = false
  private queue: ClientEvent[] = []
  private dead = false
  private token: string
  private wsUrl: string
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(token: string) {
    const base = getServerUrl() ?? import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
    this.wsUrl = base.replace(/^http/, 'ws') + '/ws'
    this.token = token
    this.connect()
  }

  private connect() {
    const ws = new WebSocket(this.wsUrl)
    this.ws = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token: this.token }))
      this.authed = true
      for (const event of this.queue) {
        ws.send(JSON.stringify(event))
      }
      this.queue = []
    }

    ws.onmessage = (e: MessageEvent<string>) => {
      const event = JSON.parse(e.data) as ServerEvent
      for (const handler of this.handlers) handler(event)
    }

    ws.onclose = () => {
      this.authed = false
      this.ws = null
      if (!this.dead) {
        this.reconnectTimer = setTimeout(() => this.connect(), 3000)
      }
    }
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

  close() {
    this.dead = true
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer)
    this.ws?.close()
  }
}
