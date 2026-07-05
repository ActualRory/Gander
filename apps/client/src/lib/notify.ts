import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
  createChannel,
  removeActive,
  removeAllActive,
  onAction,
  Importance,
  Visibility,
  type Options,
} from '@tauri-apps/plugin-notification'
import { platform } from './platform.ts'

// Single facade for OS notifications. Components never import the plugin directly.
//
// Desktop: plain { title, body } notifications, same as before — badge/tray/title
// handling stays in Main.tsx behind platform.hasWindowBadge.
//
// Android: notifications go through Android notification channels, carry a stable
// per-chat-channel id (so a burst REPLACES its own notification instead of stacking),
// and embed the channelId in `extra` so tapping deep-links back to the chat.
//
// No catch-up summary on reconnect: while the app is backgrounded the WebView's JS
// is frozen, so reconnect only ever happens on resume — when the app is visible and
// the sidebar unread badges already tell the story. An OS notification then is noise.

const MESSAGES_CHANNEL = 'messages'
const SYSTEM_CHANNEL = 'system'
const BURST_WINDOW_MS = 60_000
const MAX_INBOX_LINES = 5

let granted = false

interface Burst {
  count: number
  lines: string[]
  windowStart: number
}

const bursts = new Map<string, Burst>()

// Stable 32-bit int per chat channel (Android notification ids must be 32-bit ints).
function notificationId(channelId: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < channelId.length; i++) {
    h ^= channelId.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % 2147483647
}

export async function initNotifications(onTapChannel: (channelId: string) => void): Promise<() => void> {
  if (!platform.isTauri) return () => {}

  try {
    granted = await isPermissionGranted()
    if (!granted) {
      granted = (await requestPermission()) === 'granted'
    }
  } catch {
    granted = false
  }

  if (!platform.isMobile) return () => {}

  try {
    await createChannel({
      id: MESSAGES_CHANNEL,
      name: 'Messages',
      description: 'New messages and mentions',
      importance: Importance.High,
      visibility: Visibility.Private,
      vibration: true,
    })
    await createChannel({
      id: SYSTEM_CHANNEL,
      name: 'System',
      description: 'Invites, moderation and account notices',
      importance: Importance.Default,
    })
  } catch {
    // Channel creation failing means notifications fall back to no channel; non-fatal.
  }

  try {
    // The .d.ts types the payload as Options, but on Android the real shape is
    // { actionId: 'tap', notification: <original request incl. extra> }.
    const listener = await onAction(payload => {
      const p = payload as unknown as { notification?: { extra?: Record<string, unknown> }; extra?: Record<string, unknown> }
      const extra = p.notification?.extra ?? p.extra
      const channelId = extra?.channelId
      if (typeof channelId === 'string') onTapChannel(channelId)
    })
    return () => { listener.unregister() }
  } catch {
    return () => {}
  }
}

export function notifyMessage(opts: {
  channelId: string
  channelLabel: string
  authorName: string
  body: string
  isMention: boolean
}): void {
  if (!platform.isTauri || !granted) return

  const title = opts.isMention
    ? `${opts.channelLabel} · ${opts.authorName} mentioned you`
    : `${opts.channelLabel} · ${opts.authorName}`

  if (!platform.isMobile) {
    sendNotification({ title, body: opts.body })
    return
  }

  const now = Date.now()
  let burst = bursts.get(opts.channelId)
  if (!burst || now - burst.windowStart > BURST_WINDOW_MS) {
    burst = { count: 0, lines: [], windowStart: now }
    bursts.set(opts.channelId, burst)
  }
  burst.count++
  burst.lines.push(`${opts.authorName}: ${opts.body}`)
  if (burst.lines.length > MAX_INBOX_LINES) burst.lines.shift()

  const notification: Options = {
    id: notificationId(opts.channelId),
    channelId: MESSAGES_CHANNEL,
    group: 'gander-messages',
    autoCancel: true,
    title: burst.count > 1 ? opts.channelLabel : title,
    extra: { channelId: opts.channelId },
  }
  if (burst.count > 1) {
    notification.inboxLines = [...burst.lines]
    notification.summary = `${burst.count} messages`
    notification.number = burst.count
  } else {
    notification.body = opts.body
  }
  sendNotification(notification)
}

export function notifySystem(opts: { title: string; body?: string }): void {
  if (!platform.isTauri || !granted) return
  if (!platform.isMobile) {
    sendNotification({ title: opts.title, body: opts.body })
    return
  }
  sendNotification({
    channelId: SYSTEM_CHANNEL,
    autoCancel: true,
    title: opts.title,
    body: opts.body,
  })
}

export function clearChannelNotification(channelId: string): void {
  bursts.delete(channelId)
  if (!platform.isMobile) return
  removeActive([{ id: notificationId(channelId) }]).catch(() => {})
}

export function clearAllNotifications(): void {
  bursts.clear()
  if (!platform.isMobile) return
  removeAllActive().catch(() => {})
}
