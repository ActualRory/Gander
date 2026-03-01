# Gander

A self-hosted and non-federated Discord alternative. Run your own server; users connect to it for DMs, group text channels, and voice channels.
Still early pre-relase, use at your peril.

---

## Stack

| Layer | Technology |
|---|---|
| Desktop client | Tauri v2 + React + TypeScript + Vite |
| Server | Node.js + TypeScript + Fastify |
| Real-time | WebSockets (`@fastify/websocket`) |
| Voice | LiveKit (self-hosted, Docker) |
| Database | PostgreSQL + Prisma ORM |
| Monorepo | pnpm workspaces |

---

## Prerequisites

- **Node.js** v20+
- **pnpm** v9+ (`npm install -g pnpm`)
- **Rust + Cargo** (via [rustup.rs](https://rustup.rs)) — required by Tauri
- **Visual Studio C++ Build Tools** — required by Rust on Windows
- **Docker** (Rancher Desktop, Docker Desktop, or plain Docker) — for dev database

---

## Project Structure

```
gander/
├── apps/
│   ├── client/                  # Tauri v2 + React desktop app
│   │   ├── src/
│   │   │   ├── components/      # Reusable UI components
│   │   │   ├── lib/             # api.ts, ws.ts
│   │   │   ├── pages/           # Login.tsx, Main.tsx
│   │   │   └── styles/          # global.css (CSS custom properties)
│   │   ├── src-tauri/           # Rust wrapper (mostly boilerplate)
│   │   ├── index.html
│   │   └── vite.config.ts
│   └── server/                  # Fastify API server
│       ├── src/
│       │   ├── lib/             # prisma.ts singleton
│       │   ├── routes/          # auth.ts, channels.ts, messages.ts, voice.ts
│       │   ├── ws/              # handler.ts — WebSocket event router
│       │   └── index.ts         # Server entry point
│       └── prisma/
│           ├── schema.prisma    # Database schema
│           └── migrations/      # Generated migration SQL (committed to git)
├── packages/
│   └── shared/                  # Shared TypeScript types used by both apps
│       └── src/types/
│           ├── user.ts
│           ├── channel.ts
│           ├── message.ts
│           └── ws.ts            # ServerEvent and ClientEvent union types
├── apps/server/Dockerfile       # Production server container
├── apps/server/entrypoint.sh   # Runs migrations then starts server
├── docker-compose.dev.yml       # PostgreSQL + LiveKit for local development
├── docker-compose.yml           # Full production stack
├── livekit.prod.yaml            # LiveKit config for production
├── .env.production.example      # Required secrets for production
├── .github/workflows/release.yml # Builds Windows installer on version tag
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

---

## Development Setup

### 1. Start the database

```sh
docker compose -f docker-compose.dev.yml up -d
```

This starts a PostgreSQL 17 container on `localhost:5432` with:
- User: `gander`
- Password: `gander`
- Database: `gander`

Data is persisted in a Docker volume (`gander_dev_db`).

### 2. Configure the server

```sh
cp apps/server/.env.example apps/server/.env
```

The default `.env` matches the Docker dev database — no changes needed for local dev.

### 3. Run database migrations

```sh
pnpm --filter server db:migrate
```

On first run this creates all tables and generates the Prisma client types.

### 4. Start the server

```sh
# From repo root:
pnpm dev:server
```

Server listens on `http://localhost:3000`. Hot-reloads via `tsx watch`.

### 5. Start the client

```sh
# Browser (fastest iteration):
pnpm dev:client
# Open http://localhost:1420

# OR — native Tauri window (first run compiles Rust, ~5 min):
cd apps/client
pnpm tauri dev
```

---

## Environment Variables

`apps/server/.env`:

```env
DATABASE_URL="postgresql://gander:gander@localhost:5432/gander"
JWT_SECRET="change-me-in-production"
LIVEKIT_URL="ws://localhost:7880"
LIVEKIT_API_KEY="devkey"
LIVEKIT_API_SECRET="devsecret"
PORT=3000
```

`apps/client` (optional, `.env.local`):

```env
VITE_API_URL=http://localhost:3000
```

---

## Useful Commands

```sh
# Install all dependencies
pnpm install

# Build shared types package
pnpm --filter @gander/shared build

# Type-check server
pnpm --filter server build

# Type-check + build client
pnpm --filter client build

# Generate Prisma client after schema changes
pnpm --filter server db:generate

# Create a new migration
pnpm --filter server db:migrate

# Open Prisma Studio (database GUI)
pnpm --filter server db:studio

# Stop dev database
docker compose -f docker-compose.dev.yml down

# Stop and delete dev database volume
docker compose -f docker-compose.dev.yml down -v
```

---

## Authentication

Gander uses JWT (JSON Web Tokens) signed with `JWT_SECRET`.

- Tokens are issued on login/register and stored in React state (not localStorage — they're lost on refresh, which is intentional for now).
- Every API request sends `Authorization: Bearer <token>`.
- WebSocket connections authenticate by sending `{ type: 'auth', token }` as the first message after connecting.

Passwords are hashed with SHA-256. This is intentional simplicity for a self-hosted tool — upgrade to bcrypt before any public-facing deployment.

---

## API Reference

All routes are prefixed with `/api`. Protected routes require `Authorization: Bearer <token>`.

### Auth

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/api/auth/register` | `{ username, displayName, password }` | Create account, returns `{ token, user }` |
| POST | `/api/auth/login` | `{ username, password }` | Login, returns `{ token, user }` |

### Channels

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/api/channels` | — | List channels the user is a member of |
| POST | `/api/channels` | `{ name, type }` | Create a channel (`type`: `TEXT` or `VOICE`) |
| PATCH | `/api/channels/:id` | `{ name }` | Rename a channel (must be a member) |
| DELETE | `/api/channels/:id` | — | Delete a channel (must be a member) |
| POST | `/api/channels/:id/join` | — | Join an existing channel |

### Messages

| Method | Path | Query | Description |
|---|---|---|---|
| GET | `/api/messages/:channelId` | `?limit=50&before=<ISO date>` | Fetch message history (newest-first, reversed for display) |

### Voice

| Method | Path | Description |
|---|---|---|
| GET | `/api/voice/:channelId/token` | Get a LiveKit JWT token for joining a voice room |

### WebSocket

Connect to `ws://localhost:3000/ws`. After connecting, send auth as the first message:

```json
{ "type": "auth", "token": "<jwt>" }
```

#### Client → Server events

```ts
{ type: 'channel:join',  payload: { channelId } }
{ type: 'channel:leave', payload: { channelId } }
{ type: 'message:send',  payload: { channelId, content } }
```

#### Server → Client events

```ts
{ type: 'message:new',     payload: Message }
{ type: 'message:edited',  payload: Message }
{ type: 'message:deleted', payload: { id, channelId } }
{ type: 'presence:join',   payload: { userId, channelId } }
{ type: 'presence:leave',  payload: { userId, channelId } }
{ type: 'voice:join',      payload: { userId, channelId } }
{ type: 'voice:leave',     payload: { userId, channelId } }
```

---

## Database Schema

```
User
  id           String   (cuid)
  username     String   (unique)
  displayName  String
  passwordHash String
  createdAt    DateTime

Channel
  id        String      (cuid)
  name      String
  type      ChannelType (TEXT | VOICE | DM | GROUP)
  createdAt DateTime

ChannelMember  (join table)
  userId    → User
  channelId → Channel
  joinedAt  DateTime

Message
  id        String   (cuid)
  content   String
  createdAt DateTime
  editedAt  DateTime?
  authorId  → User
  channelId → Channel
```

---

## UI Conventions

- **Theme:** CSS custom properties defined in `apps/client/src/styles/global.css`
- **Font:** Fira Code (bundled — woff2 files in `apps/client/src/assets/fonts/`, `@font-face` declarations in `global.css`)
- **Naming:** channel names are auto-lowercased and spaces converted to hyphens
- **Modals:** overlay + centered box, Escape to close, click outside to close
- **Context menus:** right-click on channels, rendered via `createPortal` to avoid clipping

### CSS custom properties

```css
--bg-base       #1a1a0e   /* App background */
--bg-surface    #222214   /* Sidebar, panels */
--bg-elevated   #2a2a1a   /* Inputs, hover states */
--border        #3a3a28

--text-primary   #e8d5a3
--text-secondary #c8a96e
--text-muted     #7a6a4a

--accent         #c8a96e
--accent-dim     #7a6a4a
```

---

## Deployment (Production)

### Server (Ubuntu)

```sh
git clone https://github.com/you/gander
cd gander
cp .env.production.example .env
# Fill in POSTGRES_PASSWORD, JWT_SECRET, LIVEKIT_API_SECRET
# Update livekit.prod.yaml with the same LIVEKIT_API_SECRET value
docker compose up -d --build
```

Migrations run automatically on startup. Check with:

```sh
curl http://<server-ip>:3000/health   # → {"ok":true}
```

### Updating the server

```sh
git pull
docker compose build server && docker compose up -d
```

### Releasing a new client build

```sh
# Bump version in apps/client/package.json + apps/client/src-tauri/tauri.conf.json
git commit -am "v0.x.0"
git tag v0.x.0
git push && git push --tags
```

GitHub Actions builds a Windows `.exe` and `.msi` installer and publishes them as a GitHub Release (~10 min). Friends download from the Releases page.

---

## V1 Roadmap

- [x] Auth (register/login)
- [x] Text channels (create, rename, delete)
- [x] Voice channels (create, rename, delete)
- [x] Real-time messaging via WebSocket
- [x] Message history
- [x] Production Docker Compose + Dockerfile
- [x] GitHub Actions release pipeline (Windows installer)
- [ ] DMs
- [x] Voice (LiveKit integration in client)
- [ ] Presence indicators (who is online / in which voice channel)
- [x] Font bundling for distribution

## Post-V1

- [ ] HTTPS/WSS (when a domain is available — add nginx + Certbot)
- [ ] Client auto-updater (Tauri updater plugin + GitHub Releases as source)
- [ ] Screen sharing (LiveKit supports this natively)
- [ ] Mobile client (Tauri v2 mobile / React Native + LiveKit RN SDK)
