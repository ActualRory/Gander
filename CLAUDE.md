# Gander — Codebase Notes

Self-hosted Discord/Teamspeak alternative. V1: DMs, group chats, voice channels, screen sharing.

## Stack

| Layer | Tech |
|-------|------|
| Client | Tauri v2 + React + TypeScript + Vite |
| Server | Node.js + Fastify + WebSockets (@fastify/websocket) |
| Voice | LiveKit (self-hosted Docker, WebRTC SFU) |
| DB | PostgreSQL + Prisma ORM |
| Monorepo | pnpm workspaces |

## Layout

```
gander/
├── apps/client/          # Tauri v2 + React + Vite
│   └── src-tauri/        # Rust backend
├── apps/server/          # Fastify + TypeScript
├── packages/shared/      # Shared types/DTOs
├── docker-compose.dev.yml
├── docker-compose.yml    # Production (postgres + livekit + server)
└── livekit.prod.yaml
```

## Key Patterns

### API client (`apps/client/src/lib/api.ts`)
- `...options` first, then `headers:` last — Content-Type wins
- Only set `Content-Type: application/json` when body is present (DELETE = no body)
- Handle 204 No Content: `if (res.status === 204) return undefined as T`

### WebSocket auth
- Client sends `{ type: 'auth', token }` as first message after connect
- Events queued in GanderWS before auth completes
- Server closes socket with code 4001 on auth failure

### Fastify routes
- All protected routes: `app.addHook('preHandler', async (req, reply) => { await req.jwtVerify() })`
- `req.user` is `{ userId: string }` after verification

### CSS Modules
- Co-located `.tsx` + `.module.css`
- All colors via CSS custom properties — no hardcoded values except danger red (`#c87060`, `#5a3030`)
- No `border-radius`, no gradients, flat UI
- Context menus use `createPortal` to `document.body` (avoids sidebar `overflow: hidden` clipping)

### Channel names
- Auto-lowercased + spaces→hyphens: `e.target.value.toLowerCase().replace(/\s+/g, '-')`

### Message rendering (ChannelView.tsx)
- Three-layer renderer: fenced code blocks → inline markdown (`` `code` ``, `**bold**`, `*italic*`, `~~strike~~`, `||spoiler||`) → entities (URLs, @mentions, #post, #channel-name, [[book/shelf]])
- Consecutive messages from the same author within 7 min are grouped (no repeated avatar/meta; hover shows time in the avatar gutter)
- Hover action toolbar (react/reply/edit/more) on desktop pointers; hidden via `@media (hover: none)`
- Touch: long-press opens the message context menu, swipe-right replies
- ArrowUp in an empty input edits your last message

### Running dev tools (bash)
- `node`/`pnpm`/`rustc` not in Git Bash PATH — use `cmd.exe /c "..."` for tool invocations

## Aesthetic

- Warm terminal: dark bg (`#1a1a0e`), amber text (`#c8a96e`, `#e8d5a3`)
- Font: Fira Code (bundled — woff2 in `apps/client/src/assets/fonts/`, `@font-face` in `global.css`)

## Android Port

Tauri v2 supports Android. Mobile and desktop share the **same React codebase** — layout adapts via CSS, native feature availability via `platform.ts`.

### Key files

| File | Purpose |
|------|---------|
| `apps/client/src/lib/platform.ts` | Single source of truth for platform detection |
| `apps/client/src/lib/useLongPress.ts` | Long-press hook for context menus on touch |
| `apps/client/src-tauri/src/lib.rs` | Rust entry — tray/updater wrapped in `#[cfg(desktop)]` |
| `apps/client/src-tauri/Cargo.toml` | `tray-icon`/updater/process gated to `cfg(not(target_os = "android"))` |

### Platform detection rule
- **CSS `@media (pointer: coarse)` / `@media (max-width: 640px)`** — layout differences (touch targets, sidebar drawer)
- **`platform.ts` flags** — native feature availability only (`hasUpdater`, `hasWindowBadge`, `hasCloseEvent`, `hasTray`)
- Never check `__TAURI_INTERNALS__` or user-agent ad-hoc in components

### Mobile layout
- Sidebar becomes a fixed slide-in drawer on `max-width: 640px` via CSS transform
- Hamburger button in `Main.module.css` (`.hamburger`) only shown on `max-width: 640px`
- `isOpen`/`onClose` props on `Sidebar` control drawer state from `Main.tsx`
- Backdrop div in Sidebar closes drawer on tap-outside
- Long-press on channel/DM buttons opens context menu (no right-click on Android)
- `height: 100dvh` in `global.css` for soft keyboard reflow
- `font-size: max(16px, 1em)` on inputs prevents Android WebView auto-zoom

### Initializing Android target (run once)
```bash
# Prerequisites: Android NDK, ANDROID_NDK_HOME set, Rust Android targets installed
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
# From apps/client/:
pnpm tauri android init
# After init, edit src-tauri/gen/android/AndroidManifest.xml to add:
# <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
```

### Dev on Android emulator
```bash
pnpm tauri android dev   # connects to running AVD
```

### CI/CD (pending)
- Android build job needs to be added to `.github/workflows/release.yml`
- Build with `pnpm tauri android build --apk`
- Signing: keystore → base64 → GitHub secret `ANDROID_KEYSTORE_BASE64`
- APK output: `src-tauri/gen/android/app/build/outputs/apk/universal/release/`

## Known Gotchas

- `pnpm approve-builds` is interactive — add to `pnpm.onlyBuiltDependencies` in root `package.json`
- `prisma migrate dev` is interactive — pass `--name <name>`
- Client tsconfig: `allowImportingTsExtensions: true` + `noEmit: true` (bundler mode)
- Tauri icons must exist for `tauri build` — generate with `pnpm tauri icon <image>`
- WS rooms are in-process memory — multi-instance deployments need Redis Pub/Sub

## V1 Status

- [x] Auth (register/login with JWT)
- [x] Text + voice channels (create, rename, delete)
- [x] Real-time messaging via WebSocket
- [x] Message history (paginated `?before=` cursor)
- [x] DMs
- [x] Voice (LiveKit)
- [x] Screen sharing (LiveKit ScreenShare track, optional system audio, quality settings)
- [x] Font bundling (Fira Code woff2)
- [x] Production Docker Compose + GitHub Actions release pipeline
- [x] macOS support (universal binary — Intel + Apple Silicon, .dmg + auto-updater)
- [x] Android Tauri foundation (Rust side done, `tauri android init` not yet run)
- [ ] `tauri android init` + Android CI/CD job
- [ ] Apple code signing + notarization (optional — requires Apple Developer account)
- [ ] Presence indicators
