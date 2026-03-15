import { useEffect, useRef, useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { createPortal } from 'react-dom'
import type { Channel, Message, User, OgData, PinnedMessageEntry } from '@gander/shared'
import type { GanderWS } from '../lib/ws.ts'
import { api, resolveAttachmentUrl } from '../lib/api.ts'
import ContextMenu from './ContextMenu.tsx'
import ReactionPicker from './ReactionPicker.tsx'
import Avatar from './Avatar.tsx'
import styles from './ChannelView.module.css'

// Module-level OG fetch cache — persists across channel switches
const ogFetchCache = new Map<string, { data: OgData | null; fetchedAt: number }>()
const OG_TTL = 60 * 60 * 1000

const LOGO = `⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣀⣤⣶⣶⣾⣿⣷⣄⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣦⡀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣴⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣶⣤⣤⣀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠿⠿⠿⠿⠿⠗
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠟⠛⠁⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⡟⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⠏⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣸⣿⣿⣿⣿⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⣿⣿⣿⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⣿⣿⣿⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⣿⣿⣿⣿⣿⣿⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢿⣿⣿⣿⣿⣿⣇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⡆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⣿⣿⣿⣿⣿⣆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢿⣿⣿⣿⣿⣿⣿⣿⣦⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣧⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣧⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣼⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡆⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣰⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣧⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀ ⣀⣠⣤⣶⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡄⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣀⣠⣴⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣠⣴⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣧⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣤⣤⣴⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡄⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣠⣤⣴⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣧⠀⠀⠀⠀⠀
⢤⣤⣤⣤⣴⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡏⠀⠀⠀⠀⠀
⠀⠈⠙⢻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡟⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠙⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡟⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠉⠻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠋⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠿⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠟⠋⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠹⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠟⠋⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠿⠋⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠻⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠟⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⠻⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠉⣿⣿⡅⠀⠀⠀⣿⣿⡆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢹⣿⣧⠀⠀⠀⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⣿⣿⣶⣤⣤⣿⣿⣷⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⠻⠿⠿⠿⢿⣿⣿⡆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⣿⣿⣷⣀⣀⣠⣤⣶⣤⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⠿⢿⣿⣿⣿⣿⣿⠿⠿⠶⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀`

interface Props {
  channel: Channel
  token: string
  ws: GanderWS
  users: User[]
  channels: Channel[]
  currentUserId: string
  lastReadAt: string | null
  onMarkRead: () => void
  onUserRightClick: (userId: string, x: number, y: number) => void
  onNavigateToChannel: (channelId: string) => void
  jumpToMessageId?: string | null
  jumpAnchorTime?: string | null
  onNavigateToMessage?: (channelId: string, messageId: string, createdAt: string) => void
}

export default function ChannelView({ channel, token, ws, users, channels, currentUserId, onUserRightClick, lastReadAt, onMarkRead, onNavigateToChannel, jumpToMessageId, jumpAnchorTime, onNavigateToMessage }: Props) {
  const channelLabel = channel.type === 'DM'
    ? (users.find(u => u.id === channel.otherUserId)?.displayName ?? channel.name)
    : `# ${channel.name}`
  const currentUsername = users.find(u => u.id === currentUserId)?.username ?? ''
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [msgMenu, setMsgMenu] = useState<{ msgId: string; x: number; y: number } | null>(null)
  const [reactionPicker, setReactionPicker] = useState<{ msgId: string; x: number; y: number } | null>(null)
  const [reactionTooltip, setReactionTooltip] = useState<{ names: string[]; rect: DOMRect } | null>(null)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [channelQuery, setChannelQuery] = useState<string | null>(null)
  const [channelIndex, setChannelIndex] = useState(0)
  const [channelLinkTooltip, setChannelLinkTooltip] = useState<{ channel: Channel; rect: DOMRect } | null>(null)
  const [pendingAttachments, setPendingAttachments] = useState<Array<{
    file: File
    previewUrl: string
    uploading: boolean
    attachmentId: string | null
    error: string | null
  }>>([])
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editInput, setEditInput] = useState('')
  const [typingUserIds, setTypingUserIds] = useState<string[]>([])
  const lastTypingSentRef = useRef(0)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [ogData, setOgData] = useState<Map<string, OgData>>(new Map())
  const [pinsOpen, setPinsOpen] = useState(false)
  const [pins, setPins] = useState<PinnedMessageEntry[]>([])
  const [pinsLoaded, setPinsLoaded] = useState(false)
  const pinsBtnRef = useRef<HTMLButtonElement>(null)
  const pinsPanelRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const editTextareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const firstUnreadRef = useRef<HTMLDivElement | null>(null)
  const isAtBottomRef = useRef(true)
  const initialScrollDoneRef = useRef(false)

  const mentionUsers = mentionQuery !== null
    ? users.filter(u =>
        u.displayName.toLowerCase().includes(mentionQuery.toLowerCase()) ||
        u.username.toLowerCase().includes(mentionQuery.toLowerCase())
      ).slice(0, 8)
    : []

  const channelList = channelQuery !== null
    ? channels.filter(c => c.type === 'TEXT' && c.name.includes(channelQuery.toLowerCase())).slice(0, 8)
    : []

  function resize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  // Load history and join channel.
  // If jumpAnchorTime is set, load messages both before and after the anchor so
  // the target message is visible with full context (50 before + 50 after).
  useEffect(() => {
    setLoading(true)
    setMessages([])
    setReplyingTo(null)
    initialScrollDoneRef.current = false
    isAtBottomRef.current = true

    let cancelled = false
    if (jumpAnchorTime) {
      // Load messages both before and after the anchor so the target message is
      // visible in context with newer messages that came after it.
      const anchorMs = new Date(jumpAnchorTime).getTime()
      const before = new Date(anchorMs + 1000).toISOString()
      const after = new Date(anchorMs).toISOString()
      Promise.all([
        api.getMessages(token, channel.id, { before }),
        api.getMessages(token, channel.id, { after }),
      ]).then(([beforeMsgs, afterMsgs]) => {
        if (!cancelled) {
          setMessages([...beforeMsgs, ...afterMsgs])
          setLoading(false)
        }
      }).catch(() => {
        if (!cancelled) setLoading(false)
      })
    } else {
      api.getMessages(token, channel.id).then(msgs => {
        if (!cancelled) {
          setMessages(msgs)
          setLoading(false)
        }
      }).catch(() => {
        if (!cancelled) setLoading(false)
      })
    }

    ws.send({ type: 'channel:join', payload: { channelId: channel.id } })

    return () => {
      cancelled = true
      ws.send({ type: 'channel:leave', payload: { channelId: channel.id } })
    }
  // jumpAnchorTime intentionally not in deps — read at mount only (ChannelView remounts on channel change)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id, token, ws])

  // Subscribe to incoming WS events
  useEffect(() => {
    return ws.on(event => {
      if (event.type === 'message:new' && event.payload.channelId === channel.id) {
        setMessages(prev => [...prev, event.payload])
      }
      if (event.type === 'message:edited' && event.payload.channelId === channel.id) {
        setMessages(prev => prev.map(m => m.id === event.payload.id ? event.payload : m))
      }
      if (event.type === 'message:deleted' && event.payload.channelId === channel.id) {
        setMessages(prev => prev.filter(m => m.id !== event.payload.id))
      }
      if (event.type === 'reaction:updated' && event.payload.channelId === channel.id) {
        setMessages(prev => prev.map(m =>
          m.id === event.payload.messageId ? { ...m, reactions: event.payload.reactions } : m
        ))
      }
      if (event.type === 'typing:update' && event.payload.channelId === channel.id) {
        setTypingUserIds(event.payload.userIds.filter(id => id !== currentUserId))
      }
    })
  }, [channel.id, ws])

  // Initial scroll: to first unread (centred) or to bottom
  useEffect(() => {
    if (loading) return
    if (firstUnreadRef.current) {
      firstUnreadRef.current.scrollIntoView({ block: 'center' })
    } else {
      bottomRef.current?.scrollIntoView()
    }
    initialScrollDoneRef.current = true
  }, [loading])

  // Auto-scroll on new messages only when already at bottom
  useEffect(() => {
    if (!initialScrollDoneRef.current) return
    if (isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // Jump to a specific message after load (cross-channel navigation or pinned message click)
  useEffect(() => {
    if (loading || !jumpToMessageId) return
    jumpToMessage(jumpToMessageId)
  // jumpToMessage is defined later but stable — fine as dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, jumpToMessageId])

  // Lazily load pins when the panel opens
  useEffect(() => {
    if (!pinsOpen || pinsLoaded) return
    api.getPins(token, channel.id).then(data => { setPins(data); setPinsLoaded(true) }).catch(() => { setPinsLoaded(true) })
  }, [pinsOpen, pinsLoaded, token, channel.id])

  // Close pins panel on Escape / click-outside
  useEffect(() => {
    if (!pinsOpen) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setPinsOpen(false) }
    function onDown(e: MouseEvent) {
      if (
        !pinsBtnRef.current?.contains(e.target as Node) &&
        !pinsPanelRef.current?.contains(e.target as Node)
      ) setPinsOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown) }
  }, [pinsOpen])

  function handleMessagesScroll() {
    const el = messagesContainerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
    isAtBottomRef.current = atBottom
    if (atBottom) onMarkRead()
  }

  function jumpToMessage(id: string) {
    const el = messagesContainerRef.current?.querySelector(`[data-msg-id="${id}"]`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add(styles.messageHighlight)
    setTimeout(() => el.classList.remove(styles.messageHighlight), 1200)
  }

  async function handleFilesSelected(files: FileList | File[]) {
    const validFiles = Array.from(files).filter(f => SUPPORTED_MIMES.has(f.type))
    const imageFiles = validFiles
    const available = 5 - pendingAttachments.length
    const toUpload = imageFiles.slice(0, available)
    if (toUpload.length === 0) return

    const newPending = toUpload.map(file => ({
      file,
      previewUrl: URL.createObjectURL(file),
      uploading: true,
      attachmentId: null,
      error: null,
    }))
    setPendingAttachments(prev => [...prev, ...newPending])

    try {
      const uploaded = await api.uploadAttachments(token, toUpload)
      setPendingAttachments(prev => {
        const result = [...prev]
        let uploadedIdx = 0
        for (let i = 0; i < result.length; i++) {
          if (result[i].uploading && uploadedIdx < uploaded.length) {
            result[i] = { ...result[i], uploading: false, attachmentId: uploaded[uploadedIdx].id }
            uploadedIdx++
          }
        }
        return result
      })
    } catch {
      setPendingAttachments(prev => prev.map(p =>
        p.uploading ? { ...p, uploading: false, error: 'upload failed' } : p
      ))
    }
  }

  function removePending(index: number) {
    setPendingAttachments(prev => {
      const next = [...prev]
      URL.revokeObjectURL(next[index].previewUrl)
      next.splice(index, 1)
      return next
    })
  }

  function send() {
    const trimmed = input.trim()
    const readyIds = pendingAttachments.filter(p => p.attachmentId !== null).map(p => p.attachmentId as string)
    if (!trimmed && readyIds.length === 0) return
    if (pendingAttachments.some(p => p.uploading)) return

    ws.send({
      type: 'message:send',
      payload: {
        channelId: channel.id,
        content: trimmed,
        ...(replyingTo ? { replyToId: replyingTo.id } : {}),
        ...(readyIds.length > 0 ? { attachmentIds: readyIds } : {}),
      },
    })
    for (const p of pendingAttachments) URL.revokeObjectURL(p.previewUrl)
    setInput('')
    setPendingAttachments([])
    setReplyingTo(null)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    onMarkRead()
  }

  async function jumpToPost(postNumber: number) {
    const msg = messages.find(m => m.postNumber === postNumber)
    if (msg) { jumpToMessage(msg.id); return }
    // Not in loaded messages — look up globally
    const result = await api.getMessageByPostNumber(token, postNumber)
    if (!result) return
    onNavigateToMessage?.(result.channelId, result.id, result.createdAt)
  }

  function selectChannel(name: string) {
    const pos = textareaRef.current?.selectionStart ?? input.length
    const before = input.slice(0, pos)
    const after = input.slice(pos)
    setInput(before.replace(/#([a-z][a-z0-9-]*)$/, `#${name} `) + after)
    setChannelQuery(null)
    textareaRef.current?.focus()
  }

  async function saveEdit() {
    if (!editingMessageId) return
    const trimmed = editInput.trim()
    if (!trimmed) return
    try {
      await api.editMessage(token, editingMessageId, trimmed)
    } catch { /* WS broadcast will update state on success; ignore errors */ }
    setEditingMessageId(null)
    setEditInput('')
  }

  async function handleToggleReaction(messageId: string, reaction: string) {
    const msg = messages.find(m => m.id === messageId)
    if (!msg) return
    const existing = msg.reactions.find(r => r.reaction === reaction)
    const alreadyReacted = existing?.userIds.includes(currentUserId) ?? false
    try {
      if (alreadyReacted) {
        await api.removeReaction(token, messageId, reaction)
      } else {
        await api.addReaction(token, messageId, reaction)
      }
    } catch { /* WS broadcast will correct state */ }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value
    setInput(val)
    resize()
    if (val.length > 0) {
      const now = Date.now()
      if (now - lastTypingSentRef.current > 2000) {
        lastTypingSentRef.current = now
        ws.send({ type: 'typing:start', payload: { channelId: channel.id } })
      }
    }
    const pos = e.target.selectionStart ?? val.length
    const before = val.slice(0, pos)
    const mentionMatch = before.match(/@(\S*)$/)
    if (mentionMatch) {
      setMentionQuery(mentionMatch[1])
      setMentionIndex(0)
      setChannelQuery(null)
    } else {
      setMentionQuery(null)
      // Detect #channel-name query (non-digit after #)
      const chMatch = before.match(/#([a-z][a-z0-9-]*)$/)
      if (chMatch) {
        setChannelQuery(chMatch[1])
        setChannelIndex(0)
      } else {
        setChannelQuery(null)
      }
    }
  }

  function selectMention(username: string) {
    const pos = textareaRef.current?.selectionStart ?? input.length
    const before = input.slice(0, pos)
    const after = input.slice(pos)
    setInput(before.replace(/@(\S*)$/, `@${username} `) + after)
    setMentionQuery(null)
    textareaRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (channelQuery !== null && channelList.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setChannelIndex(i => Math.min(i + 1, channelList.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setChannelIndex(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectChannel(channelList[channelIndex].name); return }
      if (e.key === 'Escape') { setChannelQuery(null); return }
    }
    if (mentionQuery !== null && mentionUsers.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, mentionUsers.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectMention(mentionUsers[mentionIndex].username); return }
      if (e.key === 'Escape') { setMentionQuery(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
    if (e.key === 'Escape' && replyingTo) {
      setReplyingTo(null)
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files).filter(f =>
      ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(f.type)
    )
    if (files.length > 0) {
      e.preventDefault()
      void handleFilesSelected(files)
    }
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    void handleFilesSelected(e.dataTransfer.files)
  }

  useEffect(() => {
    if (!lightboxUrl) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setLightboxUrl(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [lightboxUrl])

  // Fetch OG metadata for non-image URLs in messages
  useEffect(() => {
    const toFetch = new Set<string>()
    for (const msg of messages) {
      for (const url of extractWebUrls(msg.content)) {
        const cached = ogFetchCache.get(url)
        if (!cached || Date.now() - cached.fetchedAt > OG_TTL) toFetch.add(url)
      }
    }
    if (toFetch.size === 0) return
    for (const url of toFetch) {
      ogFetchCache.set(url, { data: null, fetchedAt: Date.now() })
      api.getOg(token, url).then(data => {
        ogFetchCache.set(url, { data, fetchedAt: Date.now() })
        if (data) setOgData(prev => new Map(prev).set(url, data))
      }).catch(() => {
        ogFetchCache.set(url, { data: null, fetchedAt: Date.now() })
      })
    }
  }, [messages, token])

  // Find first unread message ID (stable per mount since lastReadAt is fixed)
  const lastReadTime = lastReadAt ? new Date(lastReadAt).getTime() : null
  let firstUnreadId: string | null = null
  if (lastReadTime !== null) {
    for (const msg of messages) {
      if (new Date(msg.createdAt).getTime() > lastReadTime && msg.authorId !== currentUserId && !msg.isSystem) {
        firstUnreadId = msg.id
        break
      }
    }
  }

  return (
    <div className={styles.root} onDragOver={handleDragOver} onDrop={handleDrop}>
      <div className={styles.watermark} aria-hidden="true">
        <pre className={styles.watermarkLogo}>{LOGO}</pre>
      </div>

      <header className={styles.header}>
        <span className={styles.channelName}>{channelLabel}</span>
        {channel.topic && (
          <>
            <span className={styles.headerDivider}>│</span>
            <span className={styles.channelTopic}>{channel.topic}</span>
          </>
        )}
        {channel.type !== 'VOICE' && (
          <button
            ref={pinsBtnRef}
            className={styles.headerPinBtn}
            onClick={() => setPinsOpen(o => !o)}
            title="pinned messages"
          >
            [pinned{pinsLoaded && pins.length > 0 ? ` ${pins.length}` : ''}]
          </button>
        )}
      </header>
      {pinsOpen && pinsBtnRef.current && createPortal(
        <div
          ref={pinsPanelRef}
          className={styles.pinsPanel}
          style={{
            top: pinsBtnRef.current.getBoundingClientRect().bottom + 4,
            right: window.innerWidth - pinsBtnRef.current.getBoundingClientRect().right,
          }}
        >
          <div className={styles.pinsPanelHeader}>pinned messages</div>
          {!pinsLoaded && <div className={styles.pinsEmpty}>loading...</div>}
          {pinsLoaded && pins.length === 0 && <div className={styles.pinsEmpty}>no pinned messages</div>}
          {pinsLoaded && pins.map(p => (
            <div key={p.id} className={styles.pinEntry}>
              <div
                className={styles.pinEntryBody}
                role="button"
                tabIndex={0}
                onClick={() => { jumpToMessage(p.message.id); setPinsOpen(false) }}
                onKeyDown={e => { if (e.key === 'Enter') { jumpToMessage(p.message.id); setPinsOpen(false) } }}
              >
                <div className={styles.pinEntryMeta}>
                  {p.message.postNumber != null ? `#${p.message.postNumber} · ` : ''}{p.message.authorName}
                </div>
                <div className={styles.pinEntryContent}>
                  {p.message.content || '[attachment]'}
                </div>
              </div>
              <button
                className={styles.pinUnpinBtn}
                onClick={async () => {
                  await api.unpinMessage(token, channel.id, p.messageId)
                  setPins(prev => prev.filter(x => x.messageId !== p.messageId))
                }}
              >
                [×]
              </button>
            </div>
          ))}
        </div>,
        document.body
      )}

      <div
        ref={messagesContainerRef}
        className={styles.messages}
        onScroll={handleMessagesScroll}
      >
        {loading && <p className={styles.status}>loading...</p>}
        {!loading && messages.length === 0 && (
          <p className={styles.status}>no messages yet — say something</p>
        )}
        {messages.map((msg, i) => {
          const isFirstUnread = msg.id === firstUnreadId
          const prevMsg = messages[i - 1]
          const showDateSep = !prevMsg ||
            new Date(msg.createdAt).toDateString() !== new Date(prevMsg.createdAt).toDateString()

          return (
            <div
              key={msg.id}
              data-msg-id={msg.id}
              ref={isFirstUnread ? el => { firstUnreadRef.current = el } : undefined}
              className={styles.message}
              onContextMenu={msg.isSystem ? e => e.preventDefault() : e => { e.preventDefault(); setMsgMenu({ msgId: msg.id, x: e.clientX, y: e.clientY }) }}
            >
              {showDateSep && (
                <div className={styles.dateSeparator}>
                  <span>{getDateLabel(msg.createdAt)}</span>
                </div>
              )}
              {isFirstUnread && (
                <div className={styles.unreadDivider}>
                  <span>new messages</span>
                </div>
              )}
              {msg.isSystem ? (
                <div className={styles.systemMsg}>
                  {msg.content === 'pinned' && (
                    <>
                      {msg.replyTo && (
                        <div
                          className={styles.replyQuote}
                          onClick={() => jumpToMessage(msg.replyTo!.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={e => { if (e.key === 'Enter') jumpToMessage(msg.replyTo!.id) }}
                        >
                          <span className={styles.replyQuoteAuthor}>↩ @{msg.replyTo.authorName}</span>
                          <span className={styles.replyQuoteContent}>{msg.replyTo.content}</span>
                        </div>
                      )}
                      <span className={styles.systemMsgActor}>{msg.authorName}</span>
                      {' '}pinned a message to this channel.{' '}
                      <button className={styles.systemMsgLink} onClick={() => setPinsOpen(true)}>[see all pins]</button>
                    </>
                  )}
                  {msg.content !== 'pinned' && (() => {
                    try {
                      const d = JSON.parse(msg.content) as { type: string; from: string | null; to: string | null }
                      if (d.type === 'topic_changed') {
                        return (
                          <>
                            <span className={styles.systemMsgActor}>{msg.authorName}</span>
                            {d.to
                              ? <>{' '}changed the channel topic{d.from ? <> from <span className={styles.systemMsgQuote}>"{d.from}"</span></> : ''} to <span className={styles.systemMsgQuote}>"{d.to}"</span>.</>
                              : <>{' '}cleared the channel topic{d.from ? <> (was <span className={styles.systemMsgQuote}>"{d.from}"</span>)</> : ''}.</>
                            }
                          </>
                        )
                      }
                    } catch { /* unknown system message type */ }
                    return null
                  })()}
                </div>
              ) : (
              <div className={styles.messageRow}>
              <Avatar
                displayName={msg.authorName}
                avatarUrl={users.find(u => u.id === msg.authorId)?.avatarUrl}
                userId={msg.authorId}
                size={38}
              />
              <div className={styles.messageBody}>
              <div className={styles.meta}>
                <span
                  className={styles.author}
                  onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onUserRightClick(msg.authorId, e.clientX, e.clientY) }}
                >{msg.authorName}</span>
                <span className={styles.time}>{formatTime(msg.createdAt)}</span>
                {msg.postNumber != null && (
                  <span className={styles.postNumber}>#{msg.postNumber}{msg.editedAt ? '*' : ''}</span>
                )}
              </div>
              {msg.replyTo && (
                <div
                  className={styles.replyQuote}
                  onClick={() => jumpToMessage(msg.replyTo!.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') jumpToMessage(msg.replyTo!.id) }}
                >
                  <span className={styles.replyQuoteAuthor}>↩ @{msg.replyTo.authorName}</span>
                  <span className={styles.replyQuoteContent}>{msg.replyTo.content}</span>
                </div>
              )}
              {editingMessageId === msg.id ? (
                <div className={styles.editWrapper}>
                  <textarea
                    ref={editTextareaRef}
                    className={styles.editTextarea}
                    value={editInput}
                    rows={1}
                    onChange={e => {
                      setEditInput(e.target.value)
                      const el = editTextareaRef.current
                      if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` }
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void saveEdit() }
                      if (e.key === 'Escape') { setEditingMessageId(null); setEditInput('') }
                    }}
                    autoFocus
                  />
                  <span className={styles.editHint}>[enter] save  [esc] cancel</span>
                </div>
              ) : (
                msg.content && <p className={styles.content}>{renderContent(msg.content, currentUsername, channels, jumpToPost, onNavigateToChannel, (ch, rect) => setChannelLinkTooltip({ channel: ch, rect }), () => setChannelLinkTooltip(null))}</p>
              )}
              {msg.attachments.length > 0 && (
                <div className={styles.messageAttachments}>
                  {msg.attachments.map(att => isImageMime(att.mimeType) ? (
                    <img
                      key={att.id}
                      src={resolveAttachmentUrl(att.url)}
                      alt={att.filename}
                      className={styles.messageImage}
                      loading="lazy"
                      onClick={() => setLightboxUrl(resolveAttachmentUrl(att.url))}
                      title={`${att.filename} (${formatBytes(att.size)})`}
                    />
                  ) : (
                    <button
                      key={att.id}
                      type="button"
                      className={styles.fileChip}
                      onClick={() => void openUrl(resolveAttachmentUrl(att.url))}
                      title={att.filename}
                    >
                      <span className={styles.fileChipIcon}>[file]</span>
                      <span className={styles.fileChipName}>{att.filename}</span>
                      <span className={styles.fileChipMeta}>{formatBytes(att.size)}</span>
                    </button>
                  ))}
                </div>
              )}
              {msg.content && extractImageUrls(msg.content).map(url => (
                <img
                  key={url}
                  src={url}
                  alt={url}
                  className={styles.messageImage}
                  loading="lazy"
                  onClick={() => setLightboxUrl(url)}
                />
              ))}
              {msg.content && extractVideoUrls(msg.content).map(url => (
                <video
                  key={url}
                  src={url}
                  className={styles.messageVideo}
                  controls
                  preload="metadata"
                />
              ))}
              {msg.content && (() => {
                const urlWithOg = extractWebUrls(msg.content).find(url => ogData.has(url))
                const og = urlWithOg ? ogData.get(urlWithOg)! : null
                if (!og || !urlWithOg) return null
                return (
                  <div
                    className={styles.ogCard}
                    onClick={() => void openUrl(urlWithOg)}
                    role="link"
                    tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter') void openUrl(urlWithOg) }}
                  >
                    <div className={styles.ogCardContent}>
                      {og.siteName && <div className={styles.ogSiteName}>{og.siteName}</div>}
                      {og.title && <div className={styles.ogTitle}>{og.title}</div>}
                      {og.description && <div className={styles.ogDescription}>{og.description}</div>}
                    </div>
                    {og.imageUrl && <img src={og.imageUrl} alt="" className={styles.ogThumb} loading="lazy" />}
                  </div>
                )
              })()}
              {msg.reactions.length > 0 && (
                <div className={styles.reactions}>
                  {msg.reactions.map(r => {
                    const reacted = r.userIds.includes(currentUserId)
                    return (
                      <button
                        key={r.reaction}
                        type="button"
                        className={`${styles.reactionTag} ${reacted ? styles.reactionTagOwn : ''}`}
                        onClick={() => handleToggleReaction(msg.id, r.reaction)}
                        onMouseEnter={e => {
                          const names = r.userIds.map(id => users.find(u => u.id === id)?.displayName ?? id)
                          setReactionTooltip({ names, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })
                        }}
                        onMouseLeave={() => setReactionTooltip(null)}
                      >
                        [{r.reaction}] {r.count}
                      </button>
                    )
                  })}
                </div>
              )}
              </div>
              </div>
              )}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {msgMenu && (
        <ContextMenu
          x={msgMenu.x}
          y={msgMenu.y}
          items={[
            {
              label: 'reply',
              action: () => {
                const msg = messages.find(m => m.id === msgMenu.msgId)
                if (msg) setReplyingTo(msg)
                textareaRef.current?.focus()
              },
            },
            {
              label: 'add reaction',
              action: () => setReactionPicker({ msgId: msgMenu.msgId, x: msgMenu.x, y: msgMenu.y }),
            },
            ...(messages.find(m => m.id === msgMenu.msgId)?.postNumber != null ? [{
              label: 'copy link',
              action: () => {
                const msg = messages.find(m => m.id === msgMenu.msgId)
                if (msg?.postNumber != null) void navigator.clipboard.writeText(`#${msg.postNumber}`)
              },
            }] : []),
            {
              label: pinsLoaded && pins.some(p => p.messageId === msgMenu.msgId) ? 'unpin message' : 'pin message',
              action: async () => {
                const msgId = msgMenu.msgId
                const isPinned = pinsLoaded && pins.some(p => p.messageId === msgId)
                if (isPinned) {
                  await api.unpinMessage(token, channel.id, msgId)
                  setPins(prev => prev.filter(p => p.messageId !== msgId))
                } else {
                  await api.pinMessage(token, channel.id, msgId)
                  const updated = await api.getPins(token, channel.id)
                  setPins(updated)
                  setPinsLoaded(true)
                }
              },
            },
            ...(messages.find(m => m.id === msgMenu.msgId)?.authorId === currentUserId ? [{
              label: 'edit',
              action: () => {
                const msg = messages.find(m => m.id === msgMenu.msgId)
                if (msg) { setEditingMessageId(msg.id); setEditInput(msg.content) }
              },
            }] : []),
          ]}
          onClose={() => setMsgMenu(null)}
        />
      )}

      {reactionPicker && (
        <ReactionPicker
          x={reactionPicker.x}
          y={reactionPicker.y}
          onSelect={reaction => handleToggleReaction(reactionPicker.msgId, reaction)}
          onClose={() => setReactionPicker(null)}
        />
      )}

      {reactionTooltip && createPortal(
        <div
          className={styles.reactionTooltip}
          style={{
            left: reactionTooltip.rect.left,
            top: reactionTooltip.rect.top - 4,
            transform: 'translateY(-100%)',
          }}
        >
          {reactionTooltip.names.map((name, i) => <div key={i}>{name}</div>)}
        </div>,
        document.body
      )}

      {lightboxUrl && createPortal(
        <div
          className={styles.lightboxOverlay}
          onClick={() => setLightboxUrl(null)}
          role="dialog"
          tabIndex={0}
        >
          <img
            src={lightboxUrl}
            alt="full size"
            className={styles.lightboxImage}
            onClick={e => e.stopPropagation()}
          />
          <button type="button" className={styles.lightboxClose} onClick={() => setLightboxUrl(null)}>[close]</button>
        </div>,
        document.body
      )}

      {replyingTo && (
        <div className={styles.replyBanner}>
          <span className={styles.replyBannerText}>
            ↩ replying to <span className={styles.replyBannerAuthor}>@{replyingTo.authorName}</span>
          </span>
          <button type="button" className={styles.replyBannerCancel} onClick={() => setReplyingTo(null)}>×</button>
        </div>
      )}

      {channelQuery !== null && channelList.length > 0 && (
        <div className={styles.mentionPopup}>
          {channelList.map((c, i) => (
            <button
              key={c.id}
              type="button"
              className={`${styles.mentionOption} ${i === channelIndex ? styles.mentionOptionActive : ''}`}
              onMouseDown={e => { e.preventDefault(); selectChannel(c.name) }}
            >
              <span className={styles.mentionDisplayName}># {c.name}</span>
              {c.topic && <span className={styles.mentionUsername}>{c.topic}</span>}
            </button>
          ))}
        </div>
      )}

      {mentionQuery !== null && mentionUsers.length > 0 && (
        <div className={styles.mentionPopup}>
          {mentionUsers.map((u, i) => (
            <button
              key={u.id}
              type="button"
              className={`${styles.mentionOption} ${i === mentionIndex ? styles.mentionOptionActive : ''}`}
              onMouseDown={e => { e.preventDefault(); selectMention(u.username) }}
            >
              <span className={styles.mentionDisplayName}>{u.displayName}</span>
              <span className={styles.mentionUsername}>@{u.username}</span>
            </button>
          ))}
        </div>
      )}

      {channelLinkTooltip?.channel.topic && createPortal(
        <div
          className={styles.reactionTooltip}
          style={{
            left: channelLinkTooltip.rect.left,
            top: channelLinkTooltip.rect.top - 4,
            transform: 'translateY(-100%)',
          }}
        >
          <div>{channelLinkTooltip.channel.topic}</div>
        </div>,
        document.body
      )}

      {pendingAttachments.length > 0 && (
        <div className={styles.pendingAttachments}>
          {pendingAttachments.map((p, i) => (
            <div key={i} className={`${styles.pendingThumb} ${p.error ? styles.pendingThumbError : ''}`}>
              {isImageMime(p.file.type) ? (
                <img src={p.previewUrl} alt={p.file.name} className={styles.pendingThumbImg} />
              ) : (
                <div className={styles.pendingThumbFile}>
                  <span className={styles.pendingThumbFileName}>{p.file.name}</span>
                </div>
              )}
              {p.uploading && <span className={styles.pendingThumbStatus}>...</span>}
              {p.error && <span className={styles.pendingThumbStatus}>!</span>}
              <button type="button" className={styles.pendingThumbRemove} onClick={() => removePending(i)}>[x]</button>
            </div>
          ))}
        </div>
      )}

      {typingUserIds.length > 0 && (
        <div className={styles.typingBar}>
          {(() => {
            const names = typingUserIds.map(id => users.find(u => u.id === id)?.displayName ?? '…')
            if (names.length === 1) return <><span className={styles.typingName}>{names[0]}</span> is typing...</>
            if (names.length === 2) return <><span className={styles.typingName}>{names[0]}</span> and <span className={styles.typingName}>{names[1]}</span> are typing...</>
            return 'Several people are typing...'
          })()}
        </div>
      )}

      <form className={styles.inputBar} onSubmit={e => { e.preventDefault(); send() }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,application/zip,.exe"
          multiple
          style={{ display: 'none' }}
          onChange={e => { if (e.target.files) void handleFilesSelected(e.target.files); e.target.value = '' }}
        />
        <span className={styles.prompt}>&gt;</span>
        <textarea
          ref={textareaRef}
          className={styles.input}
          placeholder={`message ${channelLabel}`}
          value={input}
          rows={1}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          autoComplete="off"
          autoFocus
        />
        <button
          type="button"
          className={styles.attachButton}
          onClick={() => fileInputRef.current?.click()}
          title="attach file"
        >[file]</button>
      </form>
    </div>
  )
}

const SUPPORTED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf', 'text/plain', 'application/zip', 'application/x-zip-compressed',
  'application/x-msdownload', 'application/vnd.microsoft.portable-executable',
])

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

const IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|webp)(\?[^\s]*)?$/i
const VIDEO_EXT_RE = /\.(mp4|webm|mov|ogg)(\?[^\s]*)?$/i

function extractImageUrls(text: string): string[] {
  const urls: string[] = []
  const re = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g
  let m
  while ((m = re.exec(text)) !== null) {
    if (IMAGE_EXT_RE.test(m[0])) urls.push(m[0])
  }
  return urls
}

function extractVideoUrls(text: string): string[] {
  const urls: string[] = []
  const re = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g
  let m
  while ((m = re.exec(text)) !== null) {
    if (VIDEO_EXT_RE.test(m[0])) urls.push(m[0])
  }
  return urls
}

function extractWebUrls(text: string): string[] {
  const urls: string[] = []
  const re = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g
  let m
  while ((m = re.exec(text)) !== null) {
    if (!IMAGE_EXT_RE.test(m[0]) && !VIDEO_EXT_RE.test(m[0])) urls.push(m[0])
  }
  return urls
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function getDateLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'today'
  if (d.toDateString() === yesterday.toDateString()) return 'yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// Matches URLs, @mentions, #postNumber refs, and #channel-name refs in one pass
// Groups: [1]=@mention handle, [2]=#post digits, [3]=#channel name
const CONTENT_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+|@(\S+)|#(\d+)|#([a-z][a-z0-9-]*)/g

function renderContent(
  text: string,
  currentUsername: string,
  channels: Channel[],
  onJumpToPost: (n: number) => void,
  onNavigateToChannel: (channelId: string) => void,
  onChannelHover: (ch: Channel, rect: DOMRect) => void,
  onChannelLeave: () => void,
): React.ReactNode {
  const parts: React.ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  CONTENT_REGEX.lastIndex = 0
  while ((match = CONTENT_REGEX.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    if (match[1] !== undefined) {
      // @mention
      const handle = match[1]
      const isSelf = handle.toLowerCase() === currentUsername.toLowerCase()
      parts.push(
        <span key={match.index} className={`${styles.mention} ${isSelf ? styles.mentionSelf : ''}`}>
          @{handle}
        </span>
      )
    } else if (match[2] !== undefined) {
      // #postNumber — jump link
      const num = parseInt(match[2], 10)
      parts.push(
        <button
          key={match.index}
          type="button"
          className={styles.postLink}
          onClick={() => onJumpToPost(num)}
        >
          #{num}
        </button>
      )
    } else if (match[3] !== undefined) {
      // #channel-name — navigation link
      const chName = match[3]
      const ch = channels.find(c => c.name === chName && c.type === 'TEXT')
      if (ch) {
        parts.push(
          <button
            key={match.index}
            type="button"
            className={styles.channelLink}
            onClick={() => onNavigateToChannel(ch.id)}
            onMouseEnter={e => onChannelHover(ch, (e.currentTarget as HTMLElement).getBoundingClientRect())}
            onMouseLeave={onChannelLeave}
          >
            #{chName}
          </button>
        )
      } else {
        parts.push(`#${chName}`)
      }
    } else {
      // URL
      const url = match[0]
      parts.push(
        <a
          key={match.index}
          className={styles.link}
          href={url}
          onClick={e => { e.preventDefault(); void openUrl(url) }}
          rel="noopener noreferrer"
        >
          {url}
        </a>
      )
    }
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length > 0 ? parts : text
}
