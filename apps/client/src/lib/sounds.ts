// Synthesized message-notification blip — a short soft sine ping, generated
// with WebAudio so no binary asset is needed (voice join/leave keep their
// recorded honk/bell sounds).

let audioCtx: AudioContext | null = null
let lastPlayedAt = 0
const THROTTLE_MS = 2000

export function playMessageBlip() {
  const now = Date.now()
  if (now - lastPlayedAt < THROTTLE_MS) return
  lastPlayedAt = now
  try {
    audioCtx ??= new AudioContext()
    const ctx = audioCtx
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.08, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.12)
  } catch { /* audio unavailable — stay silent */ }
}
