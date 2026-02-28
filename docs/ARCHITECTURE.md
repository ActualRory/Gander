# Architecture

## System Overview

```
┌─────────────────────────────────────┐
│     Gander Desktop Client           │
│     (Tauri v2 + React + Vite)       │
│                                     │
│  ┌─────────────┐ ┌───────────────┐  │
│  │  REST/WS    │ │ LiveKit SDK   │  │
│  │  (api.ts,   │ │ (livekit-     │  │
│  │   ws.ts)    │ │  client)      │  │
│  └──────┬──────┘ └──────┬────────┘  │
└─────────┼───────────────┼───────────┘
          │               │
          ▼               ▼
┌─────────────────┐  ┌─────────────────┐
│  Gander Server  │  │  LiveKit Server  │
│  (Fastify)      │  │  (Docker)        │
│                 │  │                  │
│  • Auth         │  │  • WebRTC SFU    │
│  • Channels     │  │  • Audio routing │
│  • Messages     │  │  • Room mgmt     │
│  • Presence     │  │                  │
│  • LK tokens    │  └─────────────────┘
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   PostgreSQL    │
└─────────────────┘
```

## Request Flows

### Login

```
Client                    Server                  Database
  │                          │                       │
  ├─POST /api/auth/login─────►│                       │
  │                          ├─SELECT user WHERE──────►│
  │                          │  username=?            │
  │                          │◄────────── user ───────┤
  │                          │                       │
  │                          │ hash(password) == hash?│
  │                          │                       │
  │◄── { token, user } ──────┤                       │
  │                          │                       │
  ├─GET /ws ─────────────────►│ (upgrade to WebSocket)│
  │                          │                       │
  ├─{ type:'auth', token }───►│ jwt.verify(token)     │
  │   (first WS message)     │                       │
```

### Sending a Message

```
Client A              Server (WS handler)         Client B
   │                         │                       │
   ├─{ type:'message:send',  │                       │
   │   channelId, content }──►│                       │
   │                         │                       │
   │                         ├─INSERT message─────────►DB
   │                         │◄────────── message ────┤
   │                         │                       │
   │                         ├─broadcast to room──────►│
   │                         │  { type:'message:new', │
   │                         │    payload: message }  │
```

### Joining a Voice Channel

```
Client                    Server                  LiveKit
  │                          │                       │
  ├─GET /api/voice/:id/token─►│                       │
  │                          │ new AccessToken(...)  │
  │◄── { token, url } ───────┤                       │
  │                          │                       │
  ├─LiveKit SDK connect───────────────────────────────►│
  │  (token, url)            │                       │
  │                          │                       │
  │◄── WebRTC audio ─────────────────────────────────►│
```

## Server Architecture

### Plugin Registration Order

```ts
Fastify
  ├── @fastify/cors
  ├── @fastify/jwt        ← adds req.jwtVerify() and req.user
  ├── @fastify/websocket  ← adds websocket route support
  ├── /api/auth           ← public routes (no JWT)
  ├── /api/channels       ← protected (preHandler: jwtVerify)
  ├── /api/messages       ← protected
  ├── /api/voice          ← protected
  └── /ws                 ← WebSocket endpoint
```

### WebSocket Room Model

The WS handler maintains an in-memory map:

```ts
const rooms = new Map<channelId, Set<WebSocket>>()
```

- When a client sends `channel:join`, its socket is added to the room set.
- When a client sends `channel:leave` or disconnects, it's removed.
- `broadcast(channelId, event, exclude?)` fans out to all sockets in a room.

**Important:** This is in-process memory. If you run multiple server instances, rooms won't be shared. For multi-instance deployments, replace with Redis Pub/Sub.

### Authentication Pattern (Protected Routes)

```ts
app.addHook('preHandler', async (req, reply) => {
  try {
    await req.jwtVerify()
  } catch {
    reply.status(401).send({ error: 'Unauthorized' })
  }
})
```

After `jwtVerify()` succeeds, `req.user` is set to the decoded payload: `{ userId: string }`.

## Client Architecture

### State Ownership

```
App.tsx
  ├── auth: AuthState | null         ← JWT token + user info
  │
  └── Main.tsx
        ├── channels: Channel[]      ← fetched on mount, kept in sync
        ├── activeChannel: Channel | null
        └── wsRef: GanderWS          ← single WS connection for session
              │
              └── passed down to ChannelView
```

### API Client (`src/lib/api.ts`)

All requests go through a single `request<T>()` function that:
- Prepends `VITE_API_URL` (default `http://localhost:3000`)
- Sets `Content-Type: application/json` **only when a body is present** (DELETE requests have no body — Fastify rejects JSON content-type with empty body)
- Handles 204 No Content responses without trying to parse JSON
- Throws an `Error` with the server's `error` field on non-OK responses

```ts
// Correct spread order — headers must come LAST to win over ...options
const res = await fetch(url, {
  ...options,
  headers: { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), ...options?.headers },
})
```

### WebSocket Client (`src/lib/ws.ts`)

`GanderWS` wraps the native `WebSocket`:
- Queues `ClientEvent`s sent before auth completes
- Dispatches `ServerEvent`s to registered handlers
- Returns an unsubscribe function from `on(handler)` for use in `useEffect` cleanup

Usage pattern in components:
```ts
useEffect(() => {
  return ws.on(event => {
    if (event.type === 'message:new' && event.payload.channelId === channel.id) {
      setMessages(prev => [...prev, event.payload])
    }
  })
}, [channel.id, ws])
```

### CSS Module Conventions

- One `.module.css` per component, co-located
- All colours via CSS custom properties from `global.css` — never hardcoded except for the danger/red tones on destructive actions (`#c87060`, `#5a3030`)
- No rounded corners (`border-radius` is not used)
- No gradients
- Hover states use `var(--bg-elevated)` as background

### Modal Pattern

All modals follow the same structure:
- Full-screen overlay (`position: fixed; inset: 0`) with dark semi-transparent background
- Centred box with `var(--bg-surface)` background and `var(--border)` border
- `Escape` key closes via `window.addEventListener('keydown', ...)`
- Click-outside closes via checking `e.target === e.currentTarget` on the overlay

Context menus are rendered via `createPortal(el, document.body)` to avoid being clipped by sidebar's `overflow: hidden`.

## Data Model Notes

- IDs are `cuid()` — collision-resistant, URL-safe, roughly time-ordered.
- `ChannelMember` is the join table for the User↔Channel many-to-many. Membership is required to send messages and manage channels.
- Messages are soft-deletable in the future (add `deletedAt DateTime?` to schema).
- `editedAt` is nullable — non-null means the message was edited.

## Known Limitations (V1)

| Limitation | Notes |
|---|---|
| Single server instance | WS rooms are in-memory; no Redis |
| SHA-256 passwords | Fine for self-hosted, upgrade to bcrypt for any public deployment |
| No token refresh | JWT expires; user must re-login |
| No message pagination UI | API supports `?before=` cursor but UI doesn't use it yet |
| Voice not wired to client | Server issues LiveKit tokens; client SDK not connected yet |
| No DMs | Schema has `DM` and `GROUP` channel types; routes not implemented |
