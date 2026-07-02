# Voice Disconnect Troubleshooting & Hardening

How to diagnose "voice randomly disconnects" reports, and infra changes that remove
the most common causes.

---

## Part 1 — Getting a real diagnosis out of a vague report

The client now logs the full voice connection lifecycle to the webview console with
timestamps. Ask the reporting user (or yourself, on their machine) to open devtools
(`Ctrl+Shift+I` in the dev build) and look for lines like:

```
[voice 2026-07-02T19:41:02.113Z] joining { channel: 'general-voice', url: 'ws://...' }
[voice 2026-07-02T19:41:02.804Z] connected { channel: 'general-voice' }
[voice 2026-07-02T19:53:10.421Z] reconnecting (full) { lastStats: { quality: 'poor', ping: 240, jitter: 31, packetsLost: 8.2 } }
[voice 2026-07-02T19:53:41.001Z] disconnected { reason: 'CONNECTION_TIMEOUT', intentional: false, lastStats: ... }
```

The error modal also now shows a human-readable reason instead of a bare number.

### Disconnect reason → likely cause

| Reason | What it means | Likely cause |
|---|---|---|
| `DUPLICATE_IDENTITY` | Same account connected to voice again | User opened Gander on a second device/window and joined voice — LiveKit kicks the first connection. **Known limitation:** tokens use the bare userId as identity. |
| `SIGNAL_CLOSE` | WebSocket to LiveKit dropped | Network blip, ISP/middlebox killing long-lived plaintext `ws://` connections, laptop sleep, Wi-Fi roam. See Part 2 (wss). |
| `CONNECTION_TIMEOUT` | Reconnect attempts gave up | Sustained network loss, or UDP became blocked mid-session (VPN turned on, network switch). |
| `SERVER_SHUTDOWN` | LiveKit container stopped/restarted | Deploy, `docker compose restart`, OOM kill — check `docker compose logs livekit`. |
| `JOIN_FAILURE` | Never fully connected | Signaling reachable but media path failed — usually the UDP port range isn't forwarded, or `use_external_ip` resolved a stale IP. |
| `PARTICIPANT_REMOVED` | Server-side removal | Admin action / RoomService call. |
| `STATE_MISMATCH` | Client/server state desync | Rare; rejoin. Repeated occurrences → check LiveKit version vs `livekit-client`. |

### Quality signals before the drop

The `lastStats` object in `reconnecting`/`disconnected` log lines carries the last
polled ping/jitter/packet-loss. High jitter + rising packet loss before every drop
points at the user's network (Wi-Fi, congestion); clean stats followed by a sudden
`SIGNAL_CLOSE` points at a middlebox or the signaling path.

### "User X keeps disconnecting" but X hears everything fine

Before this fix, a brief chat-WebSocket drop broadcast an immediate `voice:leave`
even though the LiveKit connection survived — X vanished from the sidebar while
still talking. The server now waits a 20s grace period before broadcasting the
leave, and a reconnect within that window cancels it silently. If reports of this
persist, the user's chat WS is dropping for >20s at a time — check their network
and the server's reverse-proxy idle timeouts.

---

## Part 2 — Infra hardening (in rough order of payoff)

### 1. Serve LiveKit signaling over `wss://` behind Caddy

`LIVEKIT_PUBLIC_URL=ws://ip:7880` is plaintext. Consequences:

- Some ISPs/corporate networks/middleboxes silently kill long-lived cleartext
  WebSockets → mid-call `SIGNAL_CLOSE` drops.
- The Android WebView blocks cleartext traffic by default — voice will not work
  on the Android port at all without this.

Fix — add a block to the `Caddyfile`:

```
voice.yourdomain.example {
    reverse_proxy livekit:7880
}
```

Then in `.env`:

```
LIVEKIT_PUBLIC_URL=wss://voice.yourdomain.example
```

Caddy proxies WebSockets automatically and handles the TLS cert. Once this is in
place you no longer need to forward TCP 7880 on the router — only 443. Media
(UDP 50000–50100 and TCP 7881) still goes directly to the host, not through Caddy.

### 2. Explicit ICE-over-TCP fallback

`docker-compose.yml` maps `7881/tcp` and `livekit.prod.yaml` now pins it explicitly:

```yaml
rtc:
  tcp_port: 7881
```

This lets clients on UDP-blocked networks fall back to plain TCP media. It helps,
but strict firewalls that only allow 443 still fail — that's what TURN is for.

### 3. TURN over TLS (for users behind strict NATs/firewalls)

Symptom: a specific user can join (signaling works) but gets `JOIN_FAILURE`, or
drops the moment they switch to a VPN/office/mobile network. LiveKit has an
embedded TURN server:

```yaml
# livekit.prod.yaml
turn:
  enabled: true
  domain: turn.yourdomain.example
  tls_port: 5349
  cert_file: /certs/turn.crt
  key_file: /certs/turn.key
```

Caveats:

- TURN/TLS cannot go through Caddy's HTTP proxy — it needs its own port (forward
  TCP 5349) and its own certificate. LiveKit does not do ACME itself; either issue
  a cert with certbot on the host and mount it into the container, or mount Caddy's
  managed cert from the `caddy_data` volume
  (`/data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/<domain>/`).
- Only bother with this once a real user hits the UDP-blocked case — for a
  friends-and-family deployment it's usually one specific person's office/VPN.

### 4. Dynamic IP + `use_external_ip`

LiveKit resolves the host's public IP **once at startup**. If your ISP rotates
your IP, every voice join fails (`JOIN_FAILURE`) until the container restarts,
while chat keeps working via DDNS — a classic "voice broke but nothing changed"
report. Options:

- Restart on IP change: a cron that compares `curl ifconfig.me` to a cached value
  and runs `docker compose restart livekit` on mismatch.
- Or a static IP from your ISP.

### 5. Port checklist (current architecture)

| Port | Protocol | Purpose | Needed externally? |
|---|---|---|---|
| 443 | TCP+UDP | Caddy (API, chat WS, and signaling if using wss) | Yes |
| 7880 | TCP | LiveKit signaling (direct, plaintext) | Only if **not** behind Caddy |
| 7881 | TCP | ICE/TCP media fallback | Yes |
| 50000–50100 | UDP | WebRTC media | Yes |
| 5349 | TCP | TURN/TLS | Only if TURN enabled |

---

## Known remaining limitation

**Multi-device voice join kicks the first device** (`DUPLICATE_IDENTITY`): LiveKit
tokens are issued with `identity: userId` (`apps/server/src/routes/voice.ts`), so a
second connection under the same account replaces the first. Fixing it means
per-device identities (e.g. `userId#deviceId`) plus mapping identities back to users
in the participant UI. Until then: joining voice on your phone will disconnect your
desktop — by design, like Discord.
