import { memo, useEffect, useRef, useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { createPortal } from 'react-dom'
import { MAX_MESSAGE_LENGTH } from '@gander/shared'
import type { Channel, Message, User, OgData, PinnedMessageEntry } from '@gander/shared'
import type { GanderWS } from '../lib/ws.ts'
import { api, resolveAttachmentUrl } from '../lib/api.ts'
import { getServerConfig } from '../lib/config.ts'
import { platform } from '../lib/platform.ts'
import { useLongPress } from '../lib/useLongPress.ts'
import { useToast, toastApiError } from '../lib/toast.tsx'
import ContextMenu from './ContextMenu.tsx'
import ReactionPicker from './ReactionPicker.tsx'
import Avatar from './Avatar.tsx'
import BookLinkCard from './BookLinkCard.tsx'
import ShelfLinkCard from './ShelfLinkCard.tsx'
import PostLinkChip from './PostLinkChip.tsx'
import ChannelLinkChip from './ChannelLinkChip.tsx'
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
  currentUserRole: import('@gander/shared').UserRole
  lastReadAt: string | null
  onMarkRead: () => void
  onUserRightClick: (userId: string, x: number, y: number) => void
  onNavigateToChannel: (channelId: string) => void
  onNavigateToUtility?: (id: 'library' | 'file-manager' | 'gandle') => void
  jumpToMessageId?: string | null
  jumpAnchorTime?: string | null
  onNavigateToMessage?: (channelId: string, messageId: string, createdAt: string) => void
}

export default function ChannelView({ channel, token, ws, users, channels, currentUserId, currentUserRole, onUserRightClick, lastReadAt, onMarkRead, onNavigateToChannel, onNavigateToUtility, jumpToMessageId, jumpAnchorTime, onNavigateToMessage }: Props) {
  const channelLabel = channel.type === 'DM'
    ? (users.find(u => u.id === channel.otherUserId)?.displayName ?? channel.name)
    : `# ${channel.name}`
  const currentUsername = users.find(u => u.id === currentUserId)?.username ?? ''
  const toast = useToast()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasOlder, setHasOlder] = useState(true)
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [msgMenu, setMsgMenu] = useState<{ msgId: string; x: number; y: number } | null>(null)
  const [reactionPicker, setReactionPicker] = useState<{ msgId: string; x: number; y: number } | null>(null)
  const [reactionTooltip, setReactionTooltip] = useState<{ names: string[]; rect: DOMRect } | null>(null)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [channelQuery, setChannelQuery] = useState<string | null>(null)
  const [channelIndex, setChannelIndex] = useState(0)
  const [pendingAttachments, setPendingAttachments] = useState<Array<{
    file: File
    previewUrl: string
    uploading: boolean
    progress: number
    attachmentId: string | null
    error: string | null
  }>>([])
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editInput, setEditInput] = useState('')
  const [typingUserIds, setTypingUserIds] = useState<string[]>([])
  const lastTypingSentRef = useRef(0)
  const [lightbox, setLightbox] = useState<{ url: string; filename: string } | null>(null)
  const [imgMenu, setImgMenu] = useState<{ url: string; filename: string; x: number; y: number } | null>(null)
  const [imageSaved, setImageSaved] = useState(false)
  const [downloadToast, setDownloadToast] = useState<string | null>(null)
  const [ogData, setOgData] = useState<Map<string, OgData>>(new Map())
  const [pinsOpen, setPinsOpen] = useState(false)
  const [pins, setPins] = useState<PinnedMessageEntry[]>([])
  const [pinsLoaded, setPinsLoaded] = useState(false)
  const [pinsError, setPinsError] = useState<string | null>(null)
  const pinsBtnRef = useRef<HTMLButtonElement>(null)
  const pinsPanelRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const editTextareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!editingMessageId) return
    const el = editTextareaRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editingMessageId])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const firstUnreadRef = useRef<HTMLDivElement | null>(null)
  const isAtBottomRef = useRef(true)
  const initialScrollDoneRef = useRef(false)
  const ownSendScrollRef = useRef(false)
  // tempId → original payload: tracks optimistic messages awaiting server
  // echo, and holds what's needed to re-send on retry
  const pendingOwnMsgs = useRef<Map<string, { content: string; replyToId?: string; attachmentIds?: string[] }>>(new Map())
  // tempId → delivery state. 'sending' = in flight, echo expected within 10s;
  // 'queued' = WS offline, GanderWS will flush on reconnect; 'failed' = no
  // echo/reject arrived — offer retry/discard instead of a forever-dimmed row.
  const [pendingStates, setPendingStates] = useState<Record<string, 'sending' | 'queued' | 'failed'>>({})
  const pendingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [wsStatus, setWsStatus] = useState(ws.status)

  function clearPendingTimer(tempId: string) {
    const timer = pendingTimers.current.get(tempId)
    if (timer) {
      clearTimeout(timer)
      pendingTimers.current.delete(tempId)
    }
  }

  function startPendingTimer(tempId: string) {
    clearPendingTimer(tempId)
    pendingTimers.current.set(tempId, setTimeout(() => {
      pendingTimers.current.delete(tempId)
      setPendingStates(prev => prev[tempId] ? { ...prev, [tempId]: 'failed' } : prev)
    }, 10_000))
  }

  function resolvePending(tempId: string) {
    clearPendingTimer(tempId)
    setPendingStates(prev => {
      if (!(tempId in prev)) return prev
      const next = { ...prev }
      delete next[tempId]
      return next
    })
  }

  useEffect(() => ws.onStatus(setWsStatus), [ws])

  // On reconnect GanderWS flushes its queue, so queued messages are now in
  // flight — promote them to 'sending' and expect echoes
  useEffect(() => {
    if (wsStatus !== 'online') return
    const queuedIds = Object.entries(pendingStates).filter(([, s]) => s === 'queued').map(([id]) => id)
    if (queuedIds.length === 0) return
    for (const id of queuedIds) startPendingTimer(id)
    setPendingStates(prev => {
      const next = { ...prev }
      for (const id of queuedIds) next[id] = 'sending'
      return next
    })
  // pendingStates read at transition time only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsStatus])

  useEffect(() => {
    const timers = pendingTimers.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }, [])
  // Ref to the createdAt of the last received message, for catch-up fetches after reconnect
  const lastMessageCreatedAtRef = useRef<string | null>(null)
  // Long-press timer for touch context menus on message rows
  const msgLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function startMsgLongPress(msgId: string, x: number, y: number) {
    msgLongPressTimer.current = setTimeout(() => {
      msgLongPressTimer.current = null
      setMsgMenu({ msgId, x, y })
    }, 500)
  }
  function cancelMsgLongPress() {
    if (msgLongPressTimer.current !== null) {
      clearTimeout(msgLongPressTimer.current)
      msgLongPressTimer.current = null
    }
  }
  const [isAtBottom, setIsAtBottom] = useState(true)
  // Messages received from others while scrolled up — shown on the scroll-to-bottom button
  const [newWhileScrolled, setNewWhileScrolled] = useState(0)
  // Server rejected a sent message (timeout / not a member) — shown above the input
  const [sendError, setSendError] = useState<string | null>(null)
  // Re-render when the current user's timeout expires so the input unlocks
  const [, setTimeoutTick] = useState(0)
  const myTimeoutUntil = users.find(u => u.id === currentUserId)?.timeoutUntil ?? null
  const isTimedOut = myTimeoutUntil !== null && new Date(myTimeoutUntil).getTime() > Date.now()

  useEffect(() => {
    if (!isTimedOut || !myTimeoutUntil) return
    const remaining = new Date(myTimeoutUntil).getTime() - Date.now()
    const timer = setTimeout(() => setTimeoutTick(t => t + 1), remaining + 500)
    return () => clearTimeout(timer)
  }, [myTimeoutUntil, isTimedOut])
  const [videoConfirm, setVideoConfirm] = useState<{ files: File[] } | null>(null)
  // Touch swipe-right-to-reply gesture state
  const swipeState = useRef<{ msgId: string; startX: number; startY: number; dx: number; active: boolean; el: HTMLElement } | null>(null)

  function handleMsgPointerDown(msg: Message, e: React.PointerEvent) {
    startMsgLongPress(msg.id, e.clientX, e.clientY)
    // Touches starting in the left edge zone belong to the sidebar drawer's
    // edge-swipe gesture, not swipe-to-reply
    if (e.pointerType === 'touch' && e.clientX > 24) {
      swipeState.current = { msgId: msg.id, startX: e.clientX, startY: e.clientY, dx: 0, active: false, el: e.currentTarget as HTMLElement }
    }
  }

  function handleMsgPointerMove(msg: Message, e: React.PointerEvent) {
    const s = swipeState.current
    if (!s || s.msgId !== msg.id) return
    const dx = e.clientX - s.startX
    const dy = e.clientY - s.startY
    if (!s.active) {
      if (Math.abs(dy) > 24) { swipeState.current = null; return }
      if (dx <= 16) return
      s.active = true
      cancelMsgLongPress()
    }
    s.dx = dx
    const clamped = Math.max(0, Math.min(dx - 16, 96))
    s.el.style.transition = ''
    s.el.style.transform = `translateX(${clamped}px)`
  }

  function endMsgSwipe(msg: Message | null) {
    const s = swipeState.current
    if (!s) return
    s.el.style.transition = 'transform 0.15s ease-out'
    s.el.style.transform = ''
    if (msg && s.active && s.dx - 16 >= 64) {
      setReplyingTo(msg)
      textareaRef.current?.focus()
    }
    swipeState.current = null
  }

  const mentionUsers = mentionQuery !== null
    ? users.filter(u =>
        !u.isArchived && (
          u.displayName.toLowerCase().includes(mentionQuery.toLowerCase()) ||
          u.username.toLowerCase().includes(mentionQuery.toLowerCase())
        )
      ).slice(0, 8)
    : []

  const channelList = channelQuery !== null
    ? channels.filter(c => (c.type === 'TEXT' || c.type === 'VOICE') && c.name.includes(channelQuery.toLowerCase())).slice(0, 8)
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
    setLoadError(null)
    setMessages([])
    setReplyingTo(null)
    setHasOlder(true)
    initialScrollDoneRef.current = false
    isAtBottomRef.current = true

    let cancelled = false
    // A failed history load must look different from an empty channel —
    // surface the error with a retry instead of "no messages yet"
    const onLoadError = (err: unknown) => {
      if (cancelled) return
      setLoadError(err instanceof Error ? err.message : 'request failed')
      setLoading(false)
    }
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
          const combined = [...beforeMsgs, ...afterMsgs]
          setMessages(combined)
          setHasOlder(beforeMsgs.length >= 50)
          setLoading(false)
        }
      }).catch(onLoadError)
    } else {
      api.getMessages(token, channel.id).then(msgs => {
        if (!cancelled) {
          setMessages(msgs)
          setHasOlder(msgs.length >= 50)
          setLoading(false)
        }
      }).catch(onLoadError)
    }

    ws.send({ type: 'channel:join', payload: { channelId: channel.id } })

    return () => {
      cancelled = true
      ws.send({ type: 'channel:leave', payload: { channelId: channel.id } })
    }
  // jumpAnchorTime intentionally not in deps — read at mount only (ChannelView remounts on channel change)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id, token, ws, reloadNonce])

  // Subscribe to incoming WS events
  useEffect(() => {
    return ws.on(event => {
      if (event.type === 'message:new' && event.payload.channelId === channel.id) {
        if (event.payload.authorId === currentUserId && event.payload.tempId) {
          resolvePending(event.payload.tempId)
        }
        setMessages(prev => {
          // Replace our own optimistic message with the confirmed server message.
          // Prefer matching by tempId (exact); fall back to content match for old messages.
          if (event.payload.authorId === currentUserId && pendingOwnMsgs.current.size > 0) {
            const tempIdx = event.payload.tempId !== undefined
              ? prev.findIndex(m => m.id === event.payload.tempId)
              : prev.findIndex(m => pendingOwnMsgs.current.get(m.id)?.content === event.payload.content)
            if (tempIdx !== -1) {
              pendingOwnMsgs.current.delete(prev[tempIdx].id)
              const next = [...prev]
              next[tempIdx] = event.payload
              return next
            }
          }
          // Deduplicate: ignore if already present (e.g. arrived before catch-up fetch)
          if (prev.some(m => m.id === event.payload.id)) return prev
          return [...prev, event.payload]
        })
        if (event.payload.authorId !== currentUserId && !isAtBottomRef.current) {
          setNewWhileScrolled(n => n + 1)
        }
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
      if (event.type === 'message:rejected' && event.payload.channelId === channel.id) {
        // Remove the optimistic message and tell the user why it wasn't sent
        const { tempId, reason, until } = event.payload
        if (tempId) {
          pendingOwnMsgs.current.delete(tempId)
          resolvePending(tempId)
          setMessages(prev => prev.filter(m => m.id !== tempId))
        }
        const msg = reason === 'timeout'
          ? `message not sent — you are timed out${until ? ` until ${new Date(until).toLocaleString()}` : ''}`
          : reason === 'not_member'
            ? 'message not sent — you are not a member of this channel'
            : reason === 'too_long'
              ? `message not sent — too long (max ${MAX_MESSAGE_LENGTH} characters)`
              : reason === 'rate_limited'
                ? 'message not sent — sending too fast, slow down'
                : 'message not sent — server error, try again'
        setSendError(msg)
      }
    })
  }, [channel.id, ws])

  // Auto-dismiss send errors
  useEffect(() => {
    if (!sendError) return
    const timer = setTimeout(() => setSendError(null), 8000)
    return () => clearTimeout(timer)
  }, [sendError])

  // Keep lastMessageCreatedAtRef current so the reconnect handler can use it.
  // Only update from confirmed server messages — skip optimistic placeholders whose
  // client-generated createdAt could be ahead of the server clock, causing the
  // catch-up fetch to miss messages if used as the `after` cursor.
  useEffect(() => {
    if (messages.length === 0) return
    const last = messages[messages.length - 1]
    if (!pendingOwnMsgs.current.has(last.id)) {
      lastMessageCreatedAtRef.current = last.createdAt
    }
  }, [messages])

  // On WS reconnect: re-join channel for presence tracking and catch up on missed messages
  useEffect(() => {
    return ws.onReconnect(() => {
      ws.send({ type: 'channel:join', payload: { channelId: channel.id } })
      const after = lastMessageCreatedAtRef.current
      if (after) {
        api.getMessages(token, channel.id, { after }).then(missed => {
          if (missed.length === 0) return
          setMessages(prev => {
            const existingIds = new Set(prev.map(m => m.id))
            return [...prev, ...missed.filter(m => !existingIds.has(m.id))]
          })
        }).catch(() => {})
      }
    })
  }, [channel.id, token, ws])

  // Initial scroll: to first unread (centred) or to bottom.
  // When jumping to a specific message, the jump effect owns the scroll —
  // scrolling to bottom here would cancel its smooth scrollIntoView.
  useEffect(() => {
    if (loading) return
    requestAnimationFrame(() => {
      if (jumpToMessageId) {
        initialScrollDoneRef.current = true
        return
      }
      if (firstUnreadRef.current) {
        firstUnreadRef.current.scrollIntoView({ block: 'center' })
      } else {
        const el = messagesContainerRef.current
        if (el) {
          el.scrollTop = el.scrollHeight
          // Re-assert next frame: virtualized row estimates settle to real
          // heights after first paint, shifting scrollHeight
          requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })
        }
      }
      initialScrollDoneRef.current = true
    })
  // jumpToMessageId is fixed for the lifetime of this mount (part of the key)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  // Auto-scroll on new messages only when already at bottom. Own sends pin
  // instantly — a smooth scroll is cancellable mid-animation and lands short
  // when row heights settle after the fact (virtualized rows materializing,
  // URL-embedded images without dimensions). Incoming messages keep the glide.
  useEffect(() => {
    if (!initialScrollDoneRef.current) return
    if (!isAtBottomRef.current) return
    const el = messagesContainerRef.current
    if (!el) return
    if (ownSendScrollRef.current) {
      ownSendScrollRef.current = false
      el.scrollTop = el.scrollHeight
      // Re-assert next frame to absorb late layout
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
  }, [messages])

  // Bound DOM size in long sessions: when reading at the bottom, drop the
  // oldest messages beyond 400 (scrolling up reloads them from the server)
  useEffect(() => {
    if (messages.length <= 400 || !isAtBottomRef.current) return
    setMessages(prev => prev.length > 400 ? prev.slice(prev.length - 350) : prev)
    setHasOlder(true)
  }, [messages.length])

  // Jump to a specific message after load (notification click, search result,
  // pinned message, cross-channel #post link). Deferred a frame so the rows
  // have painted before we measure and scroll.
  useEffect(() => {
    if (loading || !jumpToMessageId) return
    requestAnimationFrame(() => jumpToMessage(jumpToMessageId))
  // jumpToMessage is defined later but stable — fine as dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, jumpToMessageId])

  // Lazily load pins when the panel opens
  useEffect(() => {
    if (!pinsOpen || pinsLoaded || pinsError) return
    api.getPins(token, channel.id)
      .then(data => { setPins(data); setPinsLoaded(true) })
      .catch(err => setPinsError(err instanceof Error ? err.message : 'request failed'))
  }, [pinsOpen, pinsLoaded, pinsError, token, channel.id])

  // Focus textarea on any printable keypress when nothing else is focused
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.altKey || e.metaKey) return
      if (e.key.length !== 1) return
      const focused = document.activeElement
      if (focused === textareaRef.current) return
      if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) return
      textareaRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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

  async function loadOlderMessages() {
    if (loadingOlder || !hasOlder || messages.length === 0) return
    setLoadingOlder(true)
    const el = messagesContainerRef.current
    const prevScrollHeight = el?.scrollHeight ?? 0
    try {
      const oldest = messages[0]
      const older = await api.getMessages(token, channel.id, { before: oldest.createdAt })
      if (older.length < 50) setHasOlder(false)
      if (older.length > 0) {
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.id))
          const fresh = older.filter(m => !existingIds.has(m.id))
          return [...fresh, ...prev]
        })
        // Preserve scroll position after prepending
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight - prevScrollHeight
        })
      }
    } catch { /* ignore */ }
    setLoadingOlder(false)
  }

  function handleMessagesScroll() {
    const el = messagesContainerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
    isAtBottomRef.current = atBottom
    setIsAtBottom(atBottom)
    if (atBottom) {
      setNewWhileScrolled(0)
      onMarkRead()
    }
    // Load older messages when scrolled near the top
    if (el.scrollTop < 200 && hasOlder && !loadingOlder) {
      loadOlderMessages()
    }
  }

  function scrollToBottom() {
    const el = messagesContainerRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    isAtBottomRef.current = true
    setIsAtBottom(true)
    setNewWhileScrolled(0)
  }

  function jumpToMessage(id: string) {
    const el = messagesContainerRef.current?.querySelector(`[data-msg-id="${id}"]`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add(styles.messageHighlight)
    setTimeout(() => el.classList.remove(styles.messageHighlight), 2400)
  }

  async function handleFilesSelected(files: FileList | File[], skipConfirm = false) {
    // Reject oversized files before streaming anything to the server
    const { maxUploadMb } = await getServerConfig()
    const maxBytes = maxUploadMb * 1024 * 1024
    const all = Array.from(files)
    const oversized = all.filter(f => f.size > maxBytes)
    if (oversized.length > 0) {
      const label = oversized.length === 1 ? `${oversized[0].name} is` : `${oversized.length} files are`
      toast(`${label} too large (max ${maxUploadMb} MB)`, { variant: 'error' })
    }
    const validFiles = all.filter(f => SUPPORTED_MIMES.has(f.type) && f.size <= maxBytes)
    const available = 5 - pendingAttachments.length
    const toUpload = validFiles.slice(0, available)
    if (toUpload.length === 0) return

    if (!skipConfirm) {
      const largeVideos = toUpload.filter(f => isVideoMime(f.type) && f.size > VIDEO_WARN_BYTES)
      if (largeVideos.length > 0) {
        setVideoConfirm({ files: toUpload })
        return
      }
    }

    const newPending = toUpload.map(file => ({
      file,
      previewUrl: URL.createObjectURL(file),
      uploading: true,
      progress: 0,
      attachmentId: null,
      error: null,
    }))
    setPendingAttachments(prev => [...prev, ...newPending])

    try {
      const uploaded = await api.uploadAttachments(token, toUpload, fraction => {
        setPendingAttachments(prev => prev.map(p => p.uploading ? { ...p, progress: fraction } : p))
      })
      setPendingAttachments(prev => {
        const result = [...prev]
        let uploadedIdx = 0
        for (let i = 0; i < result.length; i++) {
          if (result[i].uploading && uploadedIdx < uploaded.length) {
            result[i] = { ...result[i], uploading: false, progress: 1, attachmentId: uploaded[uploadedIdx].id }
            uploadedIdx++
          }
        }
        return result
      })
    } catch (err) {
      setPendingAttachments(prev => prev.map(p =>
        p.uploading ? { ...p, uploading: false, error: 'upload failed' } : p
      ))
      toastApiError(toast, err, 'upload failed')
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
    if (isTimedOut) return
    const trimmed = input.trim()
    const readyIds = pendingAttachments.filter(p => p.attachmentId !== null).map(p => p.attachmentId as string)
    if (!trimmed && readyIds.length === 0) return
    if (pendingAttachments.some(p => p.uploading)) return
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      setSendError(`message too long (${trimmed.length}/${MAX_MESSAGE_LENGTH} characters)`)
      return
    }

    // Optimistically add the message immediately so it's visible even if the WS
    // echo is lost (e.g. due to a brief network drop between send and broadcast).
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const optimistic: Message = {
      id: tempId,
      channelId: channel.id,
      authorId: currentUserId,
      authorName: users.find(u => u.id === currentUserId)?.displayName ?? '',
      content: trimmed,
      createdAt: new Date().toISOString(),
      editedAt: null,
      postNumber: null,
      replyTo: replyingTo
        ? { id: replyingTo.id, authorName: replyingTo.authorName, content: replyingTo.content.slice(0, 100) || '[image]' }
        : null,
      reactions: [],
      mentions: [],
      attachments: [],
      isSystem: false,
    }
    pendingOwnMsgs.current.set(tempId, {
      content: trimmed,
      ...(replyingTo ? { replyToId: replyingTo.id } : {}),
      ...(readyIds.length > 0 ? { attachmentIds: readyIds } : {}),
    })
    setMessages(prev => [...prev, optimistic])

    // Track delivery: online sends expect an echo within 10s; offline sends
    // sit in GanderWS's queue until reconnect
    const initialState = ws.status === 'online' ? 'sending' : 'queued'
    setPendingStates(prev => ({ ...prev, [tempId]: initialState }))
    if (initialState === 'sending') startPendingTimer(tempId)

    ws.send({
      type: 'message:send',
      payload: {
        channelId: channel.id,
        content: trimmed,
        tempId,
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
    // Pin to bottom once the optimistic row has rendered (the messages effect
    // handles it) — scrolling here would read the pre-render scrollHeight
    ownSendScrollRef.current = true
    isAtBottomRef.current = true
    setIsAtBottom(true)
    setNewWhileScrolled(0)
  }

  // Re-send a failed optimistic message under a fresh tempId
  function retryPending(tempId: string) {
    const payload = pendingOwnMsgs.current.get(tempId)
    if (!payload) return
    clearPendingTimer(tempId)
    pendingOwnMsgs.current.delete(tempId)
    const newTempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`
    pendingOwnMsgs.current.set(newTempId, payload)
    setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: newTempId, createdAt: new Date().toISOString() } : m))
    const initialState = ws.status === 'online' ? 'sending' : 'queued'
    setPendingStates(prev => {
      const next = { ...prev }
      delete next[tempId]
      next[newTempId] = initialState
      return next
    })
    if (initialState === 'sending') startPendingTimer(newTempId)
    ws.send({
      type: 'message:send',
      payload: {
        channelId: channel.id,
        content: payload.content,
        tempId: newTempId,
        ...(payload.replyToId ? { replyToId: payload.replyToId } : {}),
        ...(payload.attachmentIds?.length ? { attachmentIds: payload.attachmentIds } : {}),
      },
    })
  }

  function discardPending(tempId: string) {
    clearPendingTimer(tempId)
    pendingOwnMsgs.current.delete(tempId)
    setMessages(prev => prev.filter(m => m.id !== tempId))
    setPendingStates(prev => {
      const next = { ...prev }
      delete next[tempId]
      return next
    })
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
      // WS broadcast updates message state on success
      setEditingMessageId(null)
      setEditInput('')
    } catch (err) {
      // Keep the editor open with the draft so nothing is lost
      toastApiError(toast, err, "couldn't save edit")
    }
  }

  // Apply a reaction toggle to local state. `add` = true adds currentUserId,
  // false removes it. Used optimistically and to revert on API failure.
  function applyReactionLocally(messageId: string, reaction: string, add: boolean) {
    setMessages(prev => prev.map(m => {
      if (m.id !== messageId) return m
      const existing = m.reactions.find(r => r.reaction === reaction)
      let reactions
      if (add) {
        if (existing?.userIds.includes(currentUserId)) return m
        reactions = existing
          ? m.reactions.map(r => r.reaction === reaction
              ? { ...r, count: r.count + 1, userIds: [...r.userIds, currentUserId] }
              : r)
          : [...m.reactions, { reaction, count: 1, userIds: [currentUserId] }]
      } else {
        if (!existing?.userIds.includes(currentUserId)) return m
        reactions = m.reactions
          .map(r => r.reaction === reaction
            ? { ...r, count: r.count - 1, userIds: r.userIds.filter(id => id !== currentUserId) }
            : r)
          .filter(r => r.count > 0)
      }
      return { ...m, reactions }
    }))
  }

  async function handleToggleReaction(messageId: string, reaction: string) {
    const msg = messages.find(m => m.id === messageId)
    if (!msg) return
    const existing = msg.reactions.find(r => r.reaction === reaction)
    const alreadyReacted = existing?.userIds.includes(currentUserId) ?? false
    // Optimistic: toggle locally first so the tag responds instantly; the WS
    // reaction:updated broadcast confirms with authoritative state on success
    applyReactionLocally(messageId, reaction, !alreadyReacted)
    try {
      if (alreadyReacted) {
        await api.removeReaction(token, messageId, reaction)
      } else {
        await api.addReaction(token, messageId, reaction)
      }
    } catch (err) {
      // Revert the optimistic toggle — no broadcast will arrive on failure
      applyReactionLocally(messageId, reaction, alreadyReacted)
      toastApiError(toast, err, "couldn't update reaction")
    }
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
    if (e.key === 'ArrowUp' && input === '' && editingMessageId === null) {
      // Discord behaviour: up-arrow in an empty input edits your most recent message
      const lastOwn = [...messages].reverse().find(m =>
        m.authorId === currentUserId && !m.isSystem && m.content && !pendingOwnMsgs.current.has(m.id)
      )
      if (lastOwn) {
        e.preventDefault()
        setEditingMessageId(lastOwn.id)
        setEditInput(lastOwn.content)
      }
      return
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

  const dragCounter = useRef(0)
  const [dragActive, setDragActive] = useState(false)

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  function handleDragEnter(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    if (e.dataTransfer.types.includes('Files')) {
      dragCounter.current++
      setDragActive(true)
    }
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    if (dragCounter.current > 0) {
      dragCounter.current--
      if (dragCounter.current === 0) setDragActive(false)
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    dragCounter.current = 0
    setDragActive(false)
    void handleFilesSelected(e.dataTransfer.files)
  }

  async function downloadImage(url: string, filename: string) {
    if (imageSaved) return
    // Blob-anchor downloads no-op in the Android WebView (no DownloadListener
    // for blob URLs) — hand off to the system browser where the user can save
    if (platform.isMobile) {
      await openUrl(url).catch(() => {})
      return
    }
    const res = await fetch(url)
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(a.href)
    setImageSaved(true)
    setDownloadToast(filename)
    setTimeout(() => setImageSaved(false), 2000)
    setTimeout(() => setDownloadToast(null), 3000)
  }

  useEffect(() => {
    setImageSaved(false)
    if (!lightbox) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setLightbox(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [lightbox])

  // Fetch OG metadata for non-image URLs in messages (skip YouTube — we embed those directly)
  useEffect(() => {
    const toFetch = new Set<string>()
    for (const msg of messages) {
      for (const url of extractWebUrls(msg.content)) {
        if (extractYouTubeId(url)) continue
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

  // Stable-identity handler bundle for memoized rows: the object survives
  // re-renders while its fields are reassigned to the freshest closures each
  // render, so React.memo can skip unchanged rows without stale handlers.
  const rowHandlersRef = useRef<RowHandlers>({} as RowHandlers)
  const rowHandlers = rowHandlersRef.current
  rowHandlers.openMsgMenu = (msgId, x, y) => setMsgMenu({ msgId, x, y })
  rowHandlers.pointerDown = handleMsgPointerDown
  rowHandlers.pointerMove = handleMsgPointerMove
  rowHandlers.pointerUp = msg => { cancelMsgLongPress(); endMsgSwipe(msg) }
  rowHandlers.pointerCancel = () => { cancelMsgLongPress(); endMsgSwipe(null) }
  rowHandlers.pointerLeave = cancelMsgLongPress
  rowHandlers.jumpToMessage = jumpToMessage
  rowHandlers.openPins = () => setPinsOpen(true)
  rowHandlers.openReactionPicker = (msgId, x, y) => setReactionPicker({ msgId, x, y })
  rowHandlers.reply = msg => { setReplyingTo(msg); textareaRef.current?.focus() }
  rowHandlers.startEdit = msg => { setEditingMessageId(msg.id); setEditInput(msg.content) }
  rowHandlers.setEditDraft = setEditInput
  rowHandlers.saveEdit = () => { void saveEdit() }
  rowHandlers.cancelEdit = () => { setEditingMessageId(null); setEditInput('') }
  rowHandlers.onUserRightClick = onUserRightClick
  rowHandlers.toggleReaction = (msgId, reaction) => { void handleToggleReaction(msgId, reaction) }
  rowHandlers.showReactionTooltip = (names, rect) => setReactionTooltip({ names, rect })
  rowHandlers.hideReactionTooltip = () => setReactionTooltip(null)
  rowHandlers.openLightbox = (url, filename) => setLightbox({ url, filename })
  rowHandlers.openImgMenu = (url, filename, x, y) => setImgMenu({ url, filename, x, y })
  rowHandlers.retryPending = retryPending
  rowHandlers.discardPending = discardPending
  rowHandlers.jumpToPost = postNumber => { void jumpToPost(postNumber) }
  rowHandlers.onNavigateToChannel = onNavigateToChannel
  rowHandlers.onNavigateToUtility = onNavigateToUtility
  rowHandlers.setFirstUnreadEl = el => { firstUnreadRef.current = el }

  return (
    <div className={styles.root} onDragOver={handleDragOver} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      <div className={styles.watermark} aria-hidden="true">
        <pre className={styles.watermarkLogo}>{LOGO}</pre>
      </div>

      {dragActive && (
        <div className={styles.dropOverlay}>
          <div className={styles.dropOverlayBox}>drop files to upload to {channelLabel}</div>
        </div>
      )}

      <header className={styles.header}>
        <span className={styles.channelName}>{channelLabel}</span>
        {channel.type !== 'DM' && channel.type !== 'GROUP' && channel.visibility !== 'DEFAULT' && (
          <span className={styles.channelTag} title={`${channel.visibility.toLowerCase().replace('_', '-')} channel`}>
            [{channel.visibility.toLowerCase().replace('_', '-')}]
          </span>
        )}
        {channel.memberRole === 'MANAGER' && (
          <span className={styles.channelTag} title="you manage this channel">[manager]</span>
        )}
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
          {!pinsLoaded && !pinsError && <div className={styles.pinsEmpty}>loading...</div>}
          {pinsError && (
            <div className={styles.pinsEmpty}>
              couldn't load pins{' '}
              <button type="button" className={styles.retryBtn} onClick={() => setPinsError(null)}>[retry]</button>
            </div>
          )}
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
                aria-label="unpin message"
                onClick={async () => {
                  try {
                    await api.unpinMessage(token, channel.id, p.messageId)
                    setPins(prev => prev.filter(x => x.messageId !== p.messageId))
                  } catch (err) {
                    toastApiError(toast, err, "couldn't unpin message")
                  }
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
        {loadingOlder && <p className={styles.status}>loading older messages...</p>}
        {!loading && !loadingOlder && !hasOlder && messages.length > 0 && (
          <p className={styles.status}>beginning of conversation</p>
        )}
        {loading && <p className={styles.status}>loading...</p>}
        {!loading && loadError && messages.length === 0 && (
          <div className={styles.loadErrorBox}>
            <p className={styles.status}>couldn't load messages</p>
            <p className={styles.loadErrorDetail}>{loadError}</p>
            <button
              type="button"
              className={styles.retryBtn}
              onClick={() => setReloadNonce(n => n + 1)}
            >[retry]</button>
          </div>
        )}
        {!loading && !loadError && messages.length === 0 && (
          <p className={styles.status}>no messages yet — say something</p>
        )}
        {messages.map((msg, i) => {
          const isFirstUnread = msg.id === firstUnreadId
          const prevMsg = messages[i - 1]
          const showDateSep = !prevMsg ||
            new Date(msg.createdAt).toDateString() !== new Date(prevMsg.createdAt).toDateString()
          const isPending = pendingOwnMsgs.current.has(msg.id)
          const pendingState = isPending ? pendingStates[msg.id] : undefined

          return (
            <MessageRow
              key={msg.id}
              msg={msg}
              // Every message shows its own avatar/author/time/post number;
              // MessageRow retains grouped rendering if this ever becomes a setting
              grouped={false}
              showDateSep={showDateSep}
              isFirstUnread={isFirstUnread}
              isPending={isPending}
              pendingState={pendingState}
              isEditing={editingMessageId === msg.id}
              editDraft={editingMessageId === msg.id ? editInput : null}
              users={users}
              channels={channels}
              token={token}
              currentUserId={currentUserId}
              currentUsername={currentUsername}
              ogData={ogData}
              editTextareaRef={editTextareaRef}
              handlers={rowHandlers}
            />
          )
        })}
        <div ref={bottomRef} />
      </div>

      {!isAtBottom && (
        <button className={`${styles.scrollToBottomBtn}${newWhileScrolled > 0 ? ` ${styles.scrollToBottomBtnNew}` : ''}`} onClick={scrollToBottom}>
          {newWhileScrolled > 0
            ? `↓ ${newWhileScrolled} new message${newWhileScrolled === 1 ? '' : 's'}`
            : '↓ scroll to bottom'}
        </button>
      )}

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
                try {
                  if (isPinned) {
                    await api.unpinMessage(token, channel.id, msgId)
                    setPins(prev => prev.filter(p => p.messageId !== msgId))
                  } else {
                    await api.pinMessage(token, channel.id, msgId)
                    const updated = await api.getPins(token, channel.id)
                    setPins(updated)
                    setPinsLoaded(true)
                  }
                } catch (err) {
                  toastApiError(toast, err, isPinned ? "couldn't unpin message" : "couldn't pin message")
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
            ...((messages.find(m => m.id === msgMenu.msgId)?.authorId === currentUserId || currentUserRole === 'ROOT') ? [{
              label: currentUserRole === 'ROOT' && messages.find(m => m.id === msgMenu.msgId)?.authorId !== currentUserId ? 'delete (mod)' : 'delete',
              danger: true,
              action: async () => {
                const msgId = msgMenu.msgId
                setMsgMenu(null)
                try {
                  await api.deleteMessage(token, msgId)
                } catch (err) {
                  toastApiError(toast, err, "couldn't delete message")
                }
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
          existingReactions={messages.find(m => m.id === reactionPicker.msgId)?.reactions.map(r => r.reaction) ?? []}
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

      {lightbox && createPortal(
        <div
          className={styles.lightboxOverlay}
          onClick={() => setLightbox(null)}
          role="dialog"
          tabIndex={0}
        >
          <img
            src={lightbox.url}
            alt="full size"
            className={styles.lightboxImage}
            onClick={e => e.stopPropagation()}
          />
          <div className={styles.lightboxControls}>
            <button type="button" className={`${styles.lightboxClose}${imageSaved ? ` ${styles.lightboxSaved}` : ''}`} disabled={imageSaved} onClick={e => { e.stopPropagation(); void downloadImage(lightbox.url, lightbox.filename) }}>{imageSaved ? '[saved]' : platform.isMobile ? '[open]' : '[save]'}</button>
            <button type="button" className={styles.lightboxClose} onClick={() => setLightbox(null)}>[close]</button>
          </div>
        </div>,
        document.body
      )}

      {downloadToast && createPortal(
        <div className={styles.downloadToast}>downloaded {downloadToast}</div>,
        document.body
      )}

      {videoConfirm && createPortal(
        <div className={styles.lightboxOverlay} onClick={() => setVideoConfirm(null)} role="dialog" tabIndex={0}>
          <div className={styles.videoConfirmBox} onClick={e => e.stopPropagation()}>
            <div className={styles.videoConfirmTitle}>upload large video?</div>
            <div className={styles.videoConfirmFiles}>
              {videoConfirm.files.filter(f => isVideoMime(f.type) && f.size > VIDEO_WARN_BYTES).map((f, i) => (
                <div key={i} className={styles.videoConfirmFile}>
                  <span>{f.name}</span>
                  <span className={styles.videoConfirmSize}>{formatBytes(f.size)}</span>
                </div>
              ))}
            </div>
            <div className={styles.videoConfirmActions}>
              <button type="button" className={styles.videoConfirmCancel} onClick={() => setVideoConfirm(null)}>[cancel]</button>
              <button type="button" className={styles.videoConfirmOk} onClick={() => { const f = videoConfirm.files; setVideoConfirm(null); void handleFilesSelected(f, true) }}>[upload anyway]</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {imgMenu && (
        <ContextMenu
          x={imgMenu.x}
          y={imgMenu.y}
          items={[
            {
              label: platform.isMobile ? 'open image' : 'save image',
              action: () => void downloadImage(imgMenu.url, imgMenu.filename),
            },
            {
              label: 'open fullscreen',
              action: () => setLightbox({ url: imgMenu.url, filename: imgMenu.filename }),
            },
          ]}
          onClose={() => setImgMenu(null)}
        />
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
              <span className={styles.mentionDisplayName}>{c.type === 'VOICE' ? '▸' : '#'} {c.name}</span>
              {c.topic && <span className={styles.mentionUsername}>{c.topic}</span>}
              {c.type === 'VOICE' && <span className={styles.mentionUsername}>voice</span>}
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


      {pendingAttachments.length > 0 && (
        <div className={styles.pendingAttachments}>
          {pendingAttachments.map((p, i) => (
            <div key={i} className={`${styles.pendingThumb} ${p.error ? styles.pendingThumbError : ''}`}>
              {isImageMime(p.file.type) ? (
                <img src={p.previewUrl} alt={p.file.name} className={styles.pendingThumbImg} />
              ) : isVideoMime(p.file.type) ? (
                <div className={styles.pendingThumbFile}>
                  <span className={styles.pendingThumbFileIcon}>[video]</span>
                  <span className={styles.pendingThumbFileName}>{p.file.name}</span>
                </div>
              ) : (
                <div className={styles.pendingThumbFile}>
                  <span className={styles.pendingThumbFileName}>{p.file.name}</span>
                </div>
              )}
              {p.uploading && (
                <>
                  <span className={styles.pendingThumbStatus}>{Math.round(p.progress * 100)}%</span>
                  <span className={styles.pendingThumbProgress} style={{ width: `${Math.round(p.progress * 100)}%` }} />
                </>
              )}
              {p.error && <span className={styles.pendingThumbStatus}>!</span>}
              <button type="button" className={styles.pendingThumbRemove} onClick={() => removePending(i)}>[x]</button>
            </div>
          ))}
        </div>
      )}

      {typingUserIds.length > 0 && (
        <div className={styles.typingBar} role="status" aria-live="polite">
          {(() => {
            const names = typingUserIds.map(id => users.find(u => u.id === id)?.displayName ?? '…')
            if (names.length === 1) return <><span className={styles.typingName}>{names[0]}</span> is typing...</>
            if (names.length === 2) return <><span className={styles.typingName}>{names[0]}</span> and <span className={styles.typingName}>{names[1]}</span> are typing...</>
            return 'Several people are typing...'
          })()}
        </div>
      )}

      {sendError && (
        <div className={styles.sendErrorBanner}>
          <span>{sendError}</span>
          <button type="button" className={styles.replyBannerCancel} onClick={() => setSendError(null)}>×</button>
        </div>
      )}

      {wsStatus !== 'online' && (
        <div className={styles.offlineNote} role="status">offline — messages will be queued</div>
      )}

      <form className={styles.inputBar} onSubmit={e => { e.preventDefault(); send() }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/ogg,video/quicktime,application/pdf,text/plain,application/zip,.exe"
          multiple
          style={{ display: 'none' }}
          onChange={e => { if (e.target.files) void handleFilesSelected(e.target.files); e.target.value = '' }}
        />
        <span className={styles.prompt}>&gt;</span>
        <textarea
          ref={textareaRef}
          className={styles.input}
          placeholder={isTimedOut && myTimeoutUntil
            ? `you are timed out until ${new Date(myTimeoutUntil).toLocaleString()}`
            : `message ${channelLabel}`}
          value={input}
          rows={1}
          disabled={isTimedOut}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          autoComplete="off"
        />
        {input.length >= MAX_MESSAGE_LENGTH - 500 && (
          <span className={`${styles.charCounter}${input.trim().length > MAX_MESSAGE_LENGTH ? ` ${styles.charCounterOver}` : ''}`}>
            {input.length}/{MAX_MESSAGE_LENGTH}
          </span>
        )}
        <button
          type="button"
          className={styles.attachButton}
          onClick={() => fileInputRef.current?.click()}
          title="attach file"
          aria-label="attach file"
        >[file]</button>
      </form>
    </div>
  )
}

interface RowHandlers {
  openMsgMenu: (msgId: string, x: number, y: number) => void
  pointerDown: (msg: Message, e: React.PointerEvent) => void
  pointerMove: (msg: Message, e: React.PointerEvent) => void
  pointerUp: (msg: Message | null) => void
  pointerCancel: () => void
  pointerLeave: () => void
  jumpToMessage: (id: string) => void
  openPins: () => void
  openReactionPicker: (msgId: string, x: number, y: number) => void
  reply: (msg: Message) => void
  startEdit: (msg: Message) => void
  setEditDraft: (value: string) => void
  saveEdit: () => void
  cancelEdit: () => void
  onUserRightClick: (userId: string, x: number, y: number) => void
  toggleReaction: (msgId: string, reaction: string) => void
  showReactionTooltip: (names: string[], rect: DOMRect) => void
  hideReactionTooltip: () => void
  openLightbox: (url: string, filename: string) => void
  openImgMenu: (url: string, filename: string, x: number, y: number) => void
  retryPending: (tempId: string) => void
  discardPending: (tempId: string) => void
  jumpToPost: (postNumber: number) => void
  onNavigateToChannel: (channelId: string) => void
  onNavigateToUtility?: (id: 'library' | 'file-manager' | 'gandle') => void
  setFirstUnreadEl: (el: HTMLDivElement | null) => void
}

interface MessageRowProps {
  msg: Message
  grouped: boolean
  showDateSep: boolean
  isFirstUnread: boolean
  isPending: boolean
  pendingState: 'sending' | 'queued' | 'failed' | undefined
  isEditing: boolean
  editDraft: string | null
  users: User[]
  channels: Channel[]
  token: string
  currentUserId: string
  currentUsername: string
  ogData: Map<string, OgData>
  editTextareaRef: React.RefObject<HTMLTextAreaElement | null>
  handlers: RowHandlers
}

// Memoized row: with the handler bundle held referentially stable by the
// parent, typing in the composer (or any state change that doesn't touch a
// row's own props) skips reconciliation of every message row.
const MessageRow = memo(function MessageRow({ msg, grouped, showDateSep, isFirstUnread, isPending, pendingState, isEditing, editDraft, users, channels, token, currentUserId, currentUsername, ogData, editTextareaRef, handlers: H }: MessageRowProps) {
  // Touch parity for the right-click-only menus: long-press on the author
  // opens the user menu, long-press on an image opens the image menu.
  // pointerdown stops propagation so the row's own long-press/swipe stays out.
  const userLongPress = useLongPress((x, y) => H.onUserRightClick(msg.authorId, x, y))
  const imgTargetRef = useRef<{ url: string; filename: string } | null>(null)
  const imgLongPress = useLongPress((x, y) => {
    const t = imgTargetRef.current
    if (t) H.openImgMenu(t.url, t.filename, x, y)
  })
  return (
    <div
      data-msg-id={msg.id}
      ref={isFirstUnread ? H.setFirstUnreadEl : undefined}
      className={`${styles.message}${grouped ? ` ${styles.messageGrouped}` : ''}${isPending ? ` ${styles.messagePending}` : ''}${pendingState === 'failed' ? ` ${styles.messageFailed}` : ''}`}
      onContextMenu={msg.isSystem ? e => e.preventDefault() : e => { e.preventDefault(); H.openMsgMenu(msg.id, e.clientX, e.clientY) }}
      onPointerDown={msg.isSystem ? undefined : e => H.pointerDown(msg, e)}
      onPointerMove={msg.isSystem ? undefined : e => H.pointerMove(msg, e)}
      onPointerUp={() => H.pointerUp(msg.isSystem ? null : msg)}
      onPointerCancel={H.pointerCancel}
      onPointerLeave={H.pointerLeave}
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
                  onClick={() => H.jumpToMessage(msg.replyTo!.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') H.jumpToMessage(msg.replyTo!.id) }}
                >
                  <span className={styles.replyQuoteAuthor}>↩ @{msg.replyTo.authorName}</span>
                  <span className={styles.replyQuoteContent}>{msg.replyTo.content}</span>
                </div>
              )}
              <span className={styles.systemMsgActor}>{msg.authorName}</span>
              {' '}pinned a message to this channel.{' '}
              <button className={styles.systemMsgLink} onClick={H.openPins}>[see all pins]</button>
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
      {!isPending && (
        <div className={styles.msgActions}>
          <button
            type="button"
            className={styles.msgActionBtn}
            title="add reaction"
            aria-label="add reaction"
            onClick={e => { const r = e.currentTarget.getBoundingClientRect(); H.openReactionPicker(msg.id, r.left, r.bottom + 4) }}
          >[+]</button>
          <button
            type="button"
            className={styles.msgActionBtn}
            title="reply"
            aria-label="reply"
            onClick={() => H.reply(msg)}
          >[↩]</button>
          {msg.authorId === currentUserId && (
            <button
              type="button"
              className={styles.msgActionBtn}
              title="edit"
              aria-label="edit message"
              onClick={() => H.startEdit(msg)}
            >[edit]</button>
          )}
          <button
            type="button"
            className={styles.msgActionBtn}
            title="more"
            aria-label="more actions"
            onClick={e => { const r = e.currentTarget.getBoundingClientRect(); H.openMsgMenu(msg.id, r.right, r.bottom + 4) }}
          >[⋯]</button>
        </div>
      )}
      {grouped ? (
        <span className={styles.gutterTime}>{formatTimeShort(msg.createdAt)}</span>
      ) : (
      <Avatar
        displayName={msg.authorName}
        avatarUrl={users.find(u => u.id === msg.authorId)?.avatarUrl}
        userId={msg.authorId}
        size={38}
      />
      )}
      <div className={styles.messageBody}>
      {!grouped && (
      <div className={styles.meta}>
        <span
          className={styles.author}
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); H.onUserRightClick(msg.authorId, e.clientX, e.clientY) }}
          onPointerDown={e => { e.stopPropagation(); userLongPress.onPointerDown(e) }}
          onPointerUp={userLongPress.onPointerUp}
          onPointerCancel={userLongPress.onPointerCancel}
          onPointerLeave={userLongPress.onPointerLeave}
        >{msg.authorName}</span>
        <span className={styles.time}>{formatTime(msg.createdAt)}</span>
        {msg.postNumber != null && (
          <span className={styles.postNumber}>#{msg.postNumber}{msg.editedAt ? '*' : ''}</span>
        )}
      </div>
      )}
      {msg.replyTo && (
        <div
          className={styles.replyQuote}
          onClick={() => H.jumpToMessage(msg.replyTo!.id)}
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter') H.jumpToMessage(msg.replyTo!.id) }}
        >
          <span className={styles.replyQuoteAuthor}>↩ @{msg.replyTo.authorName}</span>
          <span className={styles.replyQuoteContent}>{msg.replyTo.content}</span>
        </div>
      )}
      {isEditing ? (
        <div className={styles.editWrapper}>
          <textarea
            ref={editTextareaRef}
            className={styles.editTextarea}
            value={editDraft ?? ''}
            rows={1}
            onChange={e => {
              H.setEditDraft(e.target.value)
              const el = editTextareaRef.current
              if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` }
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); H.saveEdit() }
              if (e.key === 'Escape') H.cancelEdit()
            }}
          />
          <span className={styles.editHint}>[enter] save  [esc] cancel</span>
        </div>
      ) : (
        msg.content && (
          <p className={styles.content}>
            {renderContent(msg.content, currentUsername, channels, users, token, H.jumpToPost, H.onNavigateToChannel, H.onNavigateToUtility)}
            {msg.editedAt && (msg.postNumber == null || grouped) && (
              <span className={styles.editedTag}> (edited)</span>
            )}
          </p>
        )
      )}
      {pendingState === 'queued' && (
        <span className={styles.pendingNote}>queued — will send when reconnected</span>
      )}
      {pendingState === 'failed' && (
        <span className={styles.pendingNote}>
          failed to send ·{' '}
          <button type="button" className={styles.pendingActionBtn} onClick={() => H.retryPending(msg.id)}>[retry]</button>{' '}
          <button type="button" className={styles.pendingActionBtn} onClick={() => H.discardPending(msg.id)}>[discard]</button>
        </span>
      )}
      {msg.attachments.length > 0 && (
        <div className={styles.messageAttachments}>
          {msg.attachments.map(att => isImageMime(att.mimeType) ? (
            <img
              key={att.id}
              src={resolveAttachmentUrl(att.url)}
              alt={att.filename}
              className={styles.messageImage}
              width={att.width ?? undefined}
              height={att.height ?? undefined}
              loading="lazy"
              onClick={() => H.openLightbox(resolveAttachmentUrl(att.url), att.filename)}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); H.openImgMenu(resolveAttachmentUrl(att.url), att.filename, e.clientX, e.clientY) }}
              onPointerDown={e => { e.stopPropagation(); imgTargetRef.current = { url: resolveAttachmentUrl(att.url), filename: att.filename }; imgLongPress.onPointerDown(e) }}
              onPointerUp={imgLongPress.onPointerUp}
              onPointerCancel={imgLongPress.onPointerCancel}
              onPointerLeave={imgLongPress.onPointerLeave}
              title={`${att.filename} (${formatBytes(att.size)})`}
            />
          ) : isVideoMime(att.mimeType) ? (
            <video
              key={att.id}
              src={resolveAttachmentUrl(att.url)}
              className={styles.messageVideo}
              controls
              preload="metadata"
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
      {msg.content && extractImageUrls(msg.content).map(url => {
        const urlFilename = url.split('/').pop()?.split('?')[0] || 'image'
        return (
          <img
            key={url}
            src={url}
            alt={url}
            className={styles.messageImage}
            loading="lazy"
            onClick={() => H.openLightbox(url, urlFilename)}
            onContextMenu={e => { e.preventDefault(); e.stopPropagation(); H.openImgMenu(url, urlFilename, e.clientX, e.clientY) }}
            onPointerDown={e => { e.stopPropagation(); imgTargetRef.current = { url, filename: urlFilename }; imgLongPress.onPointerDown(e) }}
            onPointerUp={imgLongPress.onPointerUp}
            onPointerCancel={imgLongPress.onPointerCancel}
            onPointerLeave={imgLongPress.onPointerLeave}
          />
        )
      })}
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
        const webUrls = extractWebUrls(msg.content)
        const ytId = webUrls.reduce<string | null>((id, url) => id ?? extractYouTubeId(url), null)
        if (ytId) {
          return (
            <div className={styles.youtubeEmbed}>
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${ytId}`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                loading="lazy"
                title="YouTube video"
              />
            </div>
          )
        }
        const urlWithOg = webUrls.find(url => ogData.has(url))
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
      {msg.content && extractLibraryLinks(msg.content).map(({ type, id }) => (
        type === 'book'
          ? <BookLinkCard key={`book:${id}`} bookId={id} token={token} onNavigateToLibrary={H.onNavigateToUtility ? () => H.onNavigateToUtility!('library') : undefined} />
          : <ShelfLinkCard key={`shelf:${id}`} shelfId={id} token={token} onNavigateToLibrary={H.onNavigateToUtility ? () => H.onNavigateToUtility!('library') : undefined} />
      ))}
      {msg.reactions.length > 0 && (
        <div className={styles.reactions}>
          {msg.reactions.map(r => {
            const reacted = r.userIds.includes(currentUserId)
            return (
              <button
                key={r.reaction}
                type="button"
                className={`${styles.reactionTag} ${reacted ? styles.reactionTagOwn : ''}`}
                onClick={() => H.toggleReaction(msg.id, r.reaction)}
                onMouseEnter={e => {
                  const names = r.userIds.map(id => users.find(u => u.id === id)?.displayName ?? id)
                  H.showReactionTooltip(names, (e.currentTarget as HTMLElement).getBoundingClientRect())
                }}
                onMouseLeave={H.hideReactionTooltip}
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
})

const VIDEO_WARN_BYTES = 50 * 1024 * 1024 // 50 MB

const SUPPORTED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
  'application/pdf', 'text/plain', 'application/zip', 'application/x-zip-compressed',
  'application/x-msdownload', 'application/vnd.microsoft.portable-executable',
])

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith('image/')
}

function isVideoMime(mimeType: string): boolean {
  return mimeType.startsWith('video/')
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

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null
    if (u.hostname === 'youtube.com' || u.hostname === 'www.youtube.com' || u.hostname === 'm.youtube.com') {
      if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || null
      return u.searchParams.get('v')
    }
  } catch { /* invalid URL */ }
  return null
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

// Compact 24h time for the grouped-message gutter (must fit the 38px avatar column)
function formatTimeShort(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
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
// Matches [[book:id]], [[shelf:id]], URLs, @mentions, #postNumber, #channel-name
const CONTENT_REGEX = /\[\[(book|shelf):([a-z0-9]+)\]\]|https?:\/\/[^\s<>"{}|\\^`[\]]+|@(\S+)|#(\d+)|#([a-z][a-z0-9-]*)/g

const UTILITY_IDS = new Set(['library', 'file-manager', 'gandle'])

function extractLibraryLinks(text: string): { type: 'book' | 'shelf'; id: string }[] {
  const regex = /\[\[(book|shelf):([a-z0-9]+)\]\]/g
  const results: { type: 'book' | 'shelf'; id: string }[] = []
  let m: RegExpExecArray | null
  while ((m = regex.exec(text)) !== null) {
    results.push({ type: m[1] as 'book' | 'shelf', id: m[2] })
  }
  return results
}

interface RenderCtx {
  currentUsername: string
  channels: Channel[]
  users: User[]
  token: string
  onJumpToPost: (n: number) => void
  onNavigateToChannel: (channelId: string) => void
  onNavigateToUtility: ((id: 'library' | 'file-manager' | 'gandle') => void) | undefined
}

function renderContent(
  text: string,
  currentUsername: string,
  channels: Channel[],
  users: User[],
  token: string,
  onJumpToPost: (n: number) => void,
  onNavigateToChannel: (channelId: string) => void,
  onNavigateToUtility: ((id: 'library' | 'file-manager' | 'gandle') => void) | undefined,
): React.ReactNode {
  const ctx: RenderCtx = { currentUsername, channels, users, token, onJumpToPost, onNavigateToChannel, onNavigateToUtility }
  return renderMarkdown(text, ctx)
}

// Layer 1: fenced code blocks (```...```) — content inside is rendered literally
function renderMarkdown(text: string, ctx: RenderCtx): React.ReactNode {
  const parts: React.ReactNode[] = []
  const fenceRe = /```(?:[a-zA-Z0-9+#-]*\n)?([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = fenceRe.exec(text)) !== null) {
    if (m.index > last) parts.push(...renderInlineMd(text.slice(last, m.index), ctx, `s${last}`))
    parts.push(
      <pre key={`f${m.index}`} className={styles.codeBlock}><code>{m[1].replace(/\n$/, '')}</code></pre>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(...renderInlineMd(text.slice(last), ctx, `s${last}`))
  return parts.length > 0 ? parts : text
}

// Layer 2: inline formatting — `code`, **bold**, ||spoiler||, ~~strike~~, *italic*.
// Formatted spans (except code) recurse so nesting works; plain runs go to renderEntities.
function renderInlineMd(text: string, ctx: RenderCtx, kp: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const re = /`([^`\n]+)`|\*\*([\s\S]+?)\*\*|\|\|([\s\S]+?)\|\||~~([\s\S]+?)~~|\*([^*\n]+)\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(...renderEntities(text.slice(last, m.index), ctx, `${kp}-p${last}`))
    const key = `${kp}-i${m.index}`
    if (m[1] !== undefined) {
      parts.push(<code key={key} className={styles.inlineCode}>{m[1]}</code>)
    } else if (m[2] !== undefined) {
      parts.push(<strong key={key}>{renderInlineMd(m[2], ctx, key)}</strong>)
    } else if (m[3] !== undefined) {
      parts.push(<Spoiler key={key}>{renderInlineMd(m[3], ctx, key)}</Spoiler>)
    } else if (m[4] !== undefined) {
      parts.push(<s key={key}>{renderInlineMd(m[4], ctx, key)}</s>)
    } else if (m[5] !== undefined) {
      parts.push(<em key={key}>{renderInlineMd(m[5], ctx, key)}</em>)
    }
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(...renderEntities(text.slice(last), ctx, `${kp}-p${last}`))
  return parts
}

function Spoiler({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <span
      className={revealed ? styles.spoilerRevealed : styles.spoiler}
      onClick={() => { if (!revealed) setRevealed(true) }}
      role={revealed ? undefined : 'button'}
      tabIndex={revealed ? undefined : 0}
      onKeyDown={e => { if (e.key === 'Enter') setRevealed(true) }}
      title={revealed ? undefined : 'spoiler — click to reveal'}
    >
      {children}
    </span>
  )
}

// Layer 3: entities — URLs, @mentions, #post refs, #channel refs, [[book/shelf]] chips
function renderEntities(text: string, ctx: RenderCtx, kp: string): React.ReactNode[] {
  const { currentUsername, channels, users, token, onJumpToPost, onNavigateToChannel, onNavigateToUtility } = ctx
  const parts: React.ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  const re = new RegExp(CONTENT_REGEX.source, 'g')
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const key = `${kp}-${match.index}`

    if (match[1] !== undefined) {
      // [[book:id]] or [[shelf:id]] — inline chip (full card rendered below message)
      const libType = match[1] as 'book' | 'shelf'
      const libId = match[2]
      parts.push(
        <span key={key} className={styles.channelLink}>
          [{libType}: {libId.slice(0, 8)}…]
        </span>
      )
    } else if (match[3] !== undefined) {
      // @mention
      const handle = match[3]
      const isSelf = handle.toLowerCase() === currentUsername.toLowerCase()
      const mentionUser = users.find(u => u.username.toLowerCase() === handle.toLowerCase())
      const displayHandle = mentionUser?.displayName ?? handle
      parts.push(
        <span key={key} className={`${styles.mention} ${isSelf ? styles.mentionSelf : ''}`}>
          @{displayHandle}
        </span>
      )
    } else if (match[4] !== undefined) {
      // #postNumber — hover quote chip
      const num = parseInt(match[4], 10)
      parts.push(
        <PostLinkChip key={key} postNumber={num} token={token} onJumpToPost={onJumpToPost} />
      )
    } else if (match[5] !== undefined) {
      // #channel-name — navigation chip
      const chName = match[5]
      const ch = channels.find(c => c.name === chName && (c.type === 'TEXT' || c.type === 'VOICE'))
      if (ch) {
        parts.push(
          <ChannelLinkChip
            key={key}
            channel={ch}
            token={token}
            onNavigate={() => onNavigateToChannel(ch.id)}
          />
        )
      } else if (UTILITY_IDS.has(chName) && onNavigateToUtility) {
        // Utility pseudo-channel link
        const fakeChannel = { id: chName, name: chName, type: 'TEXT' } as Channel
        parts.push(
          <ChannelLinkChip
            key={key}
            channel={fakeChannel}
            token={token}
            onNavigate={() => onNavigateToUtility(chName as 'library' | 'file-manager' | 'gandle')}
          />
        )
      } else {
        parts.push(`#${chName}`)
      }
    } else {
      // URL
      const url = match[0]
      parts.push(
        <a
          key={key}
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
  return parts
}
