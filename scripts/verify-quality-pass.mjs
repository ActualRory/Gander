#!/usr/bin/env node
// End-to-end verification of the permissions/robustness quality pass.
// Requires a running dev stack (docker compose -f docker-compose.dev.yml up -d,
// then pnpm --filter server dev) pointed at a THROWAWAY database — this script
// registers users and creates channels.
//
// Usage: node scripts/verify-quality-pass.mjs [baseUrl]
//   baseUrl defaults to http://localhost:3000

const BASE = process.argv[2] ?? 'http://localhost:3000'
const stamp = Date.now().toString(36)
let pass = 0
let fail = 0

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  let json = null
  try { json = await res.json() } catch { /* 204 etc. */ }
  return { status: res.status, body: json }
}

async function register(suffix) {
  const r = await req('POST', '/api/auth/register', {
    body: { username: `qa_${stamp}_${suffix}`, displayName: `QA ${suffix}`, password: 'hunter2hunter2' },
  })
  if (r.status !== 200 && r.status !== 201) throw new Error(`register ${suffix} failed: ${r.status} ${JSON.stringify(r.body)}`)
  return { token: r.body.token, userId: r.body.user.id }
}

function wsConnect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws`)
    const events = []
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token }))
      setTimeout(() => resolve({ ws, events }), 300)
    }
    ws.onmessage = e => events.push(JSON.parse(e.data))
    ws.onerror = reject
  })
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

console.log(`verifying against ${BASE}\n`)

const health = await fetch(`${BASE}/health`).then(r => r.ok).catch(() => false)
if (!health) {
  console.error('server is not reachable — start the dev stack first')
  process.exit(1)
}

// ── input validation ─────────────────────────────────────────────────────────
console.log('input validation:')
{
  const r1 = await req('POST', '/api/auth/register', { body: { username: 'x', displayName: '', password: '123' } })
  ok('register rejects bad input with 400', r1.status === 400, `got ${r1.status}`)
}

const A = await register('a')
const B = await register('b')

{
  const r = await req('POST', '/api/channels', { token: A.token, body: { type: 'TEXT' } })
  ok('channel create without name → 400 (was 500)', r.status === 400, `got ${r.status}`)
  const r2 = await req('POST', '/api/channels', { token: A.token, body: { name: 'ok-name', type: 'BOGUS' } })
  ok('channel create with bad type → 400 (was 500)', r2.status === 400, `got ${r2.status}`)
  const r3 = await req('POST', '/api/channels/read', { token: A.token, body: { reads: [{ channelId: 'nonexistent', lastReadAt: new Date().toISOString() }] } })
  ok('read-marker for unknown channel → 204 skip (was 500)', r3.status === 204, `got ${r3.status}`)
}

// ── permission matrix ────────────────────────────────────────────────────────
console.log('\npermission matrix (A owns a PRIVATE channel; B is an outsider):')
const ch = (await req('POST', '/api/channels', { token: A.token, body: { name: `qa-priv-${stamp}`, type: 'TEXT' } })).body

// A posts a message via WS so there is content + a message id
const wsA = await wsConnect(A.token)
wsA.ws.send(JSON.stringify({ type: 'message:send', payload: { channelId: ch.id, content: `secret-${stamp}`, tempId: 't1' } }))
await sleep(500)
const msgEvent = wsA.events.find(e => e.type === 'message:new')
ok('A can post in own channel', !!msgEvent)
const msgId = msgEvent?.payload?.id

{
  const r = await req('GET', `/api/messages/${ch.id}`, { token: B.token })
  ok('B reading private history → 404', r.status === 404, `got ${r.status}`)
  const r2 = await req('GET', `/api/channels/${ch.id}/preview`, { token: B.token })
  ok('B previewing private channel → 404', r2.status === 404, `got ${r2.status}`)
  const r3 = await req('GET', `/api/channels/${ch.id}/pins`, { token: B.token })
  ok('B reading private pins → 404', r3.status === 404, `got ${r3.status}`)
  if (msgId) {
    const r4 = await req('POST', `/api/reactions/${msgId}`, { token: B.token, body: { reaction: '+1' } })
    ok('B reacting in private channel → 404', r4.status === 404, `got ${r4.status}`)
  }
  const r5 = await req('GET', `/api/voice/${ch.id}/token`, { token: B.token })
  ok('B minting voice token for private channel → 404', r5.status === 404, `got ${r5.status}`)
  const r6 = await req('GET', `/api/search?q=secret-${stamp}`, { token: B.token })
  const leaked = Array.isArray(r6.body) && r6.body.some(m => m.channelId === ch.id)
  ok('B searching private content → no results', !leaked)
  const r7 = await req('GET', `/api/messages/${ch.id}`, { token: A.token })
  ok('A (member) still reads own channel → 200', r7.status === 200, `got ${r7.status}`)
}

// ── WS scoping + channel:removed ─────────────────────────────────────────────
console.log('\nWS event scoping:')
const wsB = await wsConnect(B.token)
wsB.events.length = 0
// A edits + deletes in the private channel — B must hear nothing
if (msgId) {
  await req('PATCH', `/api/messages/${msgId}`, { token: A.token, body: { content: 'edited-secret' } })
  await sleep(400)
  ok('B receives no message:edited from private channel', !wsB.events.some(e => e.type === 'message:edited'))
}
wsB.events.length = 0
// A joins voice in the private channel — B must not see it
wsA.ws.send(JSON.stringify({ type: 'voice:join', payload: { channelId: ch.id } }))
await sleep(400)
ok('B receives no voice:join from private channel', !wsB.events.some(e => e.type === 'voice:join' && e.payload.channelId === ch.id))
wsA.ws.send(JSON.stringify({ type: 'voice:leave', payload: { channelId: ch.id } }))

// invite B, then kick — B should get channel:created then channel:removed(kicked)
console.log('\nkick flow:')
wsB.events.length = 0
await req('POST', `/api/channels/${ch.id}/invite`, { token: A.token, body: { userId: B.userId } })
await sleep(400)
ok('B receives channel:created on invite', wsB.events.some(e => e.type === 'channel:created' && e.payload.id === ch.id))
wsB.events.length = 0
const kick = await req('DELETE', `/api/channels/${ch.id}/members/${B.userId}`, { token: A.token })
ok('A (creator) can kick B → 204', kick.status === 204, `got ${kick.status}`)
await sleep(400)
ok('B receives channel:removed(kicked)', wsB.events.some(e => e.type === 'channel:removed' && e.payload.reason === 'kicked'))

// ── message caps + WS rate limit ─────────────────────────────────────────────
console.log('\nmessage limits:')
{
  wsA.events.length = 0
  wsA.ws.send(JSON.stringify({ type: 'message:send', payload: { channelId: ch.id, content: 'x'.repeat(4001), tempId: 'toolong' } }))
  await sleep(400)
  ok('over-length WS send → rejected too_long', wsA.events.some(e => e.type === 'message:rejected' && e.payload.reason === 'too_long'))

  wsA.events.length = 0
  for (let i = 0; i < 25; i++) {
    wsA.ws.send(JSON.stringify({ type: 'message:send', payload: { channelId: ch.id, content: `flood ${i}`, tempId: `f${i}` } }))
  }
  await sleep(1500)
  ok('WS flood → rate_limited rejections', wsA.events.some(e => e.type === 'message:rejected' && e.payload.reason === 'rate_limited'))
}

// ── HTTP rate limit (login) ──────────────────────────────────────────────────
console.log('\nHTTP rate limits:')
{
  let got429 = false
  for (let i = 0; i < 8; i++) {
    const r = await req('POST', '/api/auth/login', { body: { username: 'nosuchuser', password: 'wrong' } })
    if (r.status === 429) { got429 = true; break }
  }
  ok('login brute-force → 429 within 8 attempts', got429)
}

// ── heartbeat contract ───────────────────────────────────────────────────────
console.log('\nheartbeat:')
{
  wsA.events.length = 0
  wsA.ws.send(JSON.stringify({ type: 'ping', payload: { t: Date.now() } }))
  await sleep(300)
  ok('app-level ping → pong', wsA.events.some(e => e.type === 'pong'))
}

wsA.ws.close()
wsB.ws.close()

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
