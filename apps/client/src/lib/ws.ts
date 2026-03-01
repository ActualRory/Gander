import type { ServerEvent, ClientEvent } from '@gander/shared'
import { getServerUrl } from './config.ts'

type EventHandler = (event: ServerEvent) => void

export class GanderWS {
  private ws: WebSocket
  private handlers = new Set<EventHandler>()
  private authed = false
  private queue: ClientEvent[] = []

  constructor(token: string) {
    const base = getServerUrl() ?? import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
    const wsUrl = base.replace(/^http/, 'ws') + '/ws'

    this.ws = new WebSocket(wsUrl)

    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({ type: 'auth', token }))
      this.authed = true
      for (const event of this.queue) {
        this.ws.send(JSON.stringify(event))
      }
      this.queue = []
    }

    this.ws.onmessage = (e: MessageEvent<string>) => {
      const event = JSON.parse(e.data) as ServerEvent
      for (const handler of this.handlers) handler(event)
    }
  }

  send(event: ClientEvent) {
    if (this.authed) {
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
    this.ws.close()
  }
}
