import { useEffect, useRef, useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { createPortal } from 'react-dom'
import type { Channel, Message, User } from '@gander/shared'
import type { GanderWS } from '../lib/ws.ts'
import { api, resolveAttachmentUrl } from '../lib/api.ts'
import ContextMenu from './ContextMenu.tsx'
import ReactionPicker from './ReactionPicker.tsx'
import styles from './ChannelView.module.css'

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
  currentUserId: string
  lastReadAt: string | null
  onMarkRead: () => void
  onUserRightClick: (userId: string, x: number, y: number) => void
}

export default function ChannelView({ channel, token, ws, users, currentUserId, onUserRightClick, lastReadAt, onMarkRead }: Props) {
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
  const [pendingAttachments, setPendingAttachments] = useState<Array<{
    file: File
    previewUrl: string
    uploading: boolean
    attachmentId: string | null
    error: string | null
  }>>([])
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
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

  function resize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  // Load history and join channel
  useEffect(() => {
    setLoading(true)
    setMessages([])
    setReplyingTo(null)
    initialScrollDoneRef.current = false
    isAtBottomRef.current = true

    let cancelled = false
    api.getMessages(token, channel.id).then(msgs => {
      if (!cancelled) {
        setMessages(msgs)
        setLoading(false)
      }
    }).catch(() => {
      if (!cancelled) setLoading(false)
    })

    ws.send({ type: 'channel:join', payload: { channelId: channel.id } })

    return () => {
      cancelled = true
      ws.send({ type: 'channel:leave', payload: { channelId: channel.id } })
    }
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
    const imageFiles = Array.from(files).filter(f =>
      ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(f.type)
    )
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
    // Detect @mention query: find @word immediately before cursor with no space after @
    const pos = e.target.selectionStart ?? val.length
    const before = val.slice(0, pos)
    const match = before.match(/@(\S*)$/)
    if (match) {
      setMentionQuery(match[1])
      setMentionIndex(0)
    } else {
      setMentionQuery(null)
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

  // Find first unread message ID (stable per mount since lastReadAt is fixed)
  const lastReadTime = lastReadAt ? new Date(lastReadAt).getTime() : null
  let firstUnreadId: string | null = null
  if (lastReadTime !== null) {
    for (const msg of messages) {
      if (new Date(msg.createdAt).getTime() > lastReadTime && msg.authorId !== currentUserId) {
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
      </header>

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
              onContextMenu={e => { e.preventDefault(); setMsgMenu({ msgId: msg.id, x: e.clientX, y: e.clientY }) }}
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
              <div className={styles.meta}>
                <span
                  className={styles.author}
                  onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onUserRightClick(msg.authorId, e.clientX, e.clientY) }}
                >{msg.authorName}</span>
                <span className={styles.time}>{formatTime(msg.createdAt)}</span>
                {msg.postNumber != null && (
                  <span className={styles.postNumber}>#{msg.postNumber}</span>
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
              {msg.content && <p className={styles.content}>{renderContent(msg.content, currentUsername)}</p>}
              {msg.attachments.length > 0 && (
                <div className={styles.messageAttachments}>
                  {msg.attachments.map(att => (
                    <img
                      key={att.id}
                      src={resolveAttachmentUrl(att.url)}
                      alt={att.filename}
                      className={styles.messageImage}
                      loading="lazy"
                      onClick={() => setLightboxUrl(resolveAttachmentUrl(att.url))}
                      title={`${att.filename} (${formatBytes(att.size)})`}
                    />
                  ))}
                </div>
              )}
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

      {pendingAttachments.length > 0 && (
        <div className={styles.pendingAttachments}>
          {pendingAttachments.map((p, i) => (
            <div key={i} className={`${styles.pendingThumb} ${p.error ? styles.pendingThumbError : ''}`}>
              <img src={p.previewUrl} alt={p.file.name} className={styles.pendingThumbImg} />
              {p.uploading && <span className={styles.pendingThumbStatus}>...</span>}
              {p.error && <span className={styles.pendingThumbStatus}>!</span>}
              <button type="button" className={styles.pendingThumbRemove} onClick={() => removePending(i)}>[x]</button>
            </div>
          ))}
        </div>
      )}

      <form className={styles.inputBar} onSubmit={e => { e.preventDefault(); send() }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          multiple
          style={{ display: 'none' }}
          onChange={e => { if (e.target.files) void handleFilesSelected(e.target.files); e.target.value = '' }}
        />
        <button
          type="button"
          className={styles.attachButton}
          onClick={() => fileInputRef.current?.click()}
          title="attach image"
        >[img]</button>
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
      </form>
    </div>
  )
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

// Matches URLs or @mention handles in one pass
const CONTENT_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+|@(\S+)/g

function renderContent(text: string, currentUsername: string): React.ReactNode {
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
