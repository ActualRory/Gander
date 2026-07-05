import { useEffect, useRef, useState } from 'react'
import goosehonkUrl from '../../sounds/goosehonk1.mp3?url'
import hangupUrl from '../../sounds/goosebell_hangup1.mp3?url'
import { Room, RoomEvent, Track, AudioPresets, VideoPresets, ScreenSharePresets, LocalAudioTrack, ConnectionQuality, DisconnectReason, createAudioAnalyser, type RemoteAudioTrack, type RemoteVideoTrack, type LocalVideoTrack } from 'livekit-client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { Image as TauriImage } from '@tauri-apps/api/image'
import { platform } from '../lib/platform.ts'
import { initNotifications, notifyMessage, notifySystem, clearChannelNotification } from '../lib/notify.ts'
import { isAppVisible } from '../lib/useAppVisibility.ts'
import type { Channel, User, UserRole } from '@gander/shared'
import type { AuthState } from '../App.tsx'
import { api } from '../lib/api.ts'
import { GanderWS, type ConnectionStatus } from '../lib/ws.ts'
import Sidebar from '../components/Sidebar.tsx'
import ChannelView from '../components/ChannelView.tsx'
import LibraryView from '../components/LibraryView.tsx'
import FileManagerView from '../components/FileManagerView.tsx'
import GandleView from '../components/GandleView.tsx'
import ChannelIndexPage from '../components/ChannelIndexPage.tsx'
import AdminPanel from '../components/AdminPanel.tsx'
import SocialPanel from '../components/SocialPanel.tsx'
import ErrorModal from '../components/ErrorModal.tsx'
import SettingsModal from '../components/SettingsModal.tsx'
import type { VoiceStats } from '../components/VoiceControls.tsx'
import type { CameraQuality, ScreenShareQuality } from '../components/SettingsModal.tsx'
import { type VideoTile } from '../components/VideoGrid.tsx'
import StreamView from '../components/StreamView.tsx'
import UserProfilePopup from '../components/UserProfilePopup.tsx'
import QuickSwitcher from '../components/QuickSwitcher.tsx'
import UserProfileModal from '../components/UserProfileModal.tsx'
import ContextMenu from '../components/ContextMenu.tsx'
import { RNNoiseProcessor, rnnoiseSupported } from '../lib/rnnoiseProcessor.ts'
import UpdateBanner from '../components/UpdateBanner.tsx'
import RecoverySetupModal from '../components/RecoverySetupModal.tsx'
import InvitePeopleModal from '../components/InvitePeopleModal.tsx'
import { useAppUpdater } from '../lib/useAppUpdater.ts'
import { useAndroidUpdateCheck } from '../lib/useAndroidUpdateCheck.ts'
import { useToast, toastApiError } from '../lib/toast.tsx'
import { playMessageBlip } from '../lib/sounds.ts'
import styles from './Main.module.css'

interface Props {
  auth: AuthState
  onLogout: () => void
}

function playHonks(count: number) {
  for (let i = 0; i < count; i++) {
    const delay = i * 140 + Math.random() * 60
    setTimeout(() => {
      const audio = new Audio(goosehonkUrl)
      audio.volume = 0.7 + Math.random() * 0.3
      audio.play().catch(() => {})
    }, delay)
  }
}

async function makeBadgeOverlay(text: string): Promise<TauriImage> {
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#c8a96e'
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#1a1a0e'
  ctx.font = `bold ${text.length > 1 ? 13 : 17}px monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, size / 2, size / 2 + 1)
  const base64 = canvas.toDataURL('image/png').split(',')[1]
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return TauriImage.fromBytes(bytes)
}

function loadHidden(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`gander:hidden:${userId}`)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch { return new Set() }
}

function saveHidden(userId: string, hidden: Set<string>) {
  localStorage.setItem(`gander:hidden:${userId}`, JSON.stringify([...hidden]))
}

function loadHiddenUtilities(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`gander:hidden-utilities:${userId}`)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch { return new Set() }
}

function saveHiddenUtilities(userId: string, hidden: Set<string>) {
  localStorage.setItem(`gander:hidden-utilities:${userId}`, JSON.stringify([...hidden]))
}

function loadMuted(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`gander:muted:${userId}`)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch { return new Set() }
}

function saveMuted(userId: string, muted: Set<string>) {
  localStorage.setItem(`gander:muted:${userId}`, JSON.stringify([...muted]))
}

interface VoiceSettings {
  pttMode: boolean
  pttKey: string
  outputVolume: number
  noiseSuppression: boolean
  echoCancellation: boolean
  autoGainControl: boolean
  selectedInputDevice: string
  selectedOutputDevice: string
  rnnoiseEnabled: boolean
  cameraQuality: CameraQuality
  screenShareQuality: ScreenShareQuality
  screenShareAudio: boolean
}

const VOICE_SETTINGS_DEFAULTS: VoiceSettings = {
  pttMode: false,
  pttKey: 'Space',
  outputVolume: 1,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  selectedInputDevice: '',
  selectedOutputDevice: '',
  rnnoiseEnabled: false,
  cameraQuality: '1080p',
  screenShareQuality: '1080p30',
  screenShareAudio: true,
}

function cameraPreset(q: CameraQuality) {
  switch (q) {
    case '360p':  return VideoPresets.h360
    case '720p':  return VideoPresets.h720
    case '1080p': return VideoPresets.h1080
  }
}

function screenSharePreset(q: ScreenShareQuality) {
  switch (q) {
    case '720p15':  return ScreenSharePresets.h720fps15
    case '720p30':  return ScreenSharePresets.h720fps30
    case '1080p15': return ScreenSharePresets.h1080fps15
    case '1080p30': return ScreenSharePresets.h1080fps30
  }
}

function loadVoiceSettings(userId: string): VoiceSettings {
  try {
    const raw = localStorage.getItem(`gander:voice-settings:${userId}`)
    return raw ? { ...VOICE_SETTINGS_DEFAULTS, ...JSON.parse(raw) } : VOICE_SETTINGS_DEFAULTS
  } catch { return VOICE_SETTINGS_DEFAULTS }
}

function saveVoiceSettings(userId: string, settings: VoiceSettings) {
  localStorage.setItem(`gander:voice-settings:${userId}`, JSON.stringify(settings))
}

interface UiSettings {
  messageSound: boolean
}

const UI_SETTINGS_DEFAULTS: UiSettings = { messageSound: false }

function loadUiSettings(userId: string): UiSettings {
  try {
    const raw = localStorage.getItem(`gander:ui-settings:${userId}`)
    return raw ? { ...UI_SETTINGS_DEFAULTS, ...JSON.parse(raw) } : UI_SETTINGS_DEFAULTS
  } catch { return UI_SETTINGS_DEFAULTS }
}

function saveUiSettings(userId: string, settings: UiSettings) {
  localStorage.setItem(`gander:ui-settings:${userId}`, JSON.stringify(settings))
}

// Timestamped voice lifecycle log — lets user-reported "random disconnects" be
// matched against the webview console (connect/reconnect/disconnect + reason)
function vlog(...args: unknown[]) {
  console.info(`[voice ${new Date().toISOString()}]`, ...args)
}

// LiveKit reports disconnects as a numeric protobuf enum — translate the values
// users actually hit into actionable text (fall back to the raw enum name)
function disconnectReasonLabel(reason: DisconnectReason): string {
  switch (reason) {
    case DisconnectReason.DUPLICATE_IDENTITY: return 'you connected to voice from another device or window'
    case DisconnectReason.SERVER_SHUTDOWN: return 'the voice server shut down or restarted'
    case DisconnectReason.PARTICIPANT_REMOVED: return 'you were removed from the voice channel'
    case DisconnectReason.ROOM_DELETED:
    case DisconnectReason.ROOM_CLOSED: return 'the voice channel was closed'
    case DisconnectReason.SIGNAL_CLOSE: return 'connection to the voice server was lost'
    case DisconnectReason.CONNECTION_TIMEOUT: return 'timed out reconnecting to the voice server'
    case DisconnectReason.JOIN_FAILURE: return 'could not reach the voice server'
    case DisconnectReason.STATE_MISMATCH: return 'connection state error — try rejoining'
    default: return DisconnectReason[reason] ?? `unknown (${reason})`
  }
}

export default function Main({ auth, onLogout }: Props) {
  const toast = useToast()
  const [channels, setChannels] = useState<Channel[]>([])
  const [dmChannels, setDmChannels] = useState<Channel[]>([])
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set())
  const [userActivities, setUserActivities] = useState<Record<string, string>>({})
  const [hiddenChannelIds, setHiddenChannelIds] = useState<Set<string>>(() => loadHidden(auth.userId))
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})
  const [mentionCounts, setMentionCounts] = useState<Record<string, number>>({})
  const [mutedChannelIds, setMutedChannelIds] = useState<Set<string>>(() => loadMuted(auth.userId))
  const [profileTarget, setProfileTarget] = useState<{ user: User; x: number; y: number } | null>(null)
  const [fullProfileTarget, setFullProfileTarget] = useState<User | null>(null)
  const [userContextMenu, setUserContextMenu] = useState<{ userId: string; x: number; y: number } | null>(null)
  const [pendingJump, setPendingJump] = useState<{ messageId: string; anchorTime: string } | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [socialOpen, setSocialOpen] = useState(false)
  const [activeUtilityId, setActiveUtilityId] = useState<'library' | 'file-manager' | 'gandle' | 'admin' | null>(null)
  const [showChannelIndex, setShowChannelIndex] = useState(false)
  const [currentUserRole, setCurrentUserRole] = useState<UserRole>(() => auth.role ?? 'MEMBER')
  const [notifications, setNotifications] = useState<import('@gander/shared').Notification[]>([])
  const [showRecoverySetup, setShowRecoverySetup] = useState(false)
  const [hiddenUtilityIds, setHiddenUtilityIds] = useState<Set<string>>(() => loadHiddenUtilities(auth.userId))
  const [windowFocused, setWindowFocused] = useState(true)
  const [inviteTarget, setInviteTarget] = useState<Channel | null>(null)
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('connecting')
  const [everConnected, setEverConnected] = useState(false)
  const [baseLoading, setBaseLoading] = useState(true)
  const [baseError, setBaseError] = useState<string | null>(null)
  const windowFocusedRef = useRef(true)
  const wsRef = useRef<GanderWS | null>(null)
  // Per-channel lastReadAt, server-authoritative (populated by loadBaseData).
  // Kept in a ref — only consumed when snapshotting at channel-open time.
  const lastReadMapRef = useRef<Record<string, string>>({})
  const lastHiddenAtRef = useRef<number | null>(null)
  const pendingNotificationChannelIdRef = useRef<string | null>(null)
  // lastReadAt of the active channel, captured *before* it was marked read —
  // drives the "new messages" divider in ChannelView
  const [activeChannelLastRead, setActiveChannelLastRead] = useState<string | null>(null)
  const activeChannelRef = useRef<Channel | null>(null)
  const channelsRef = useRef<Channel[]>([])
  const dmChannelsRef = useRef<Channel[]>([])
  const mutedChannelIdsRef = useRef<Set<string>>(new Set())

  // Voice state
  const voiceRoomRef = useRef<Room | null>(null)
  const [voiceChannelId, setVoiceChannelId] = useState<string | null>(null)
  const [voiceParticipants, setVoiceParticipants] = useState<Record<string, string[]>>({})
  const [voiceChannelStartTimes, setVoiceChannelStartTimes] = useState<Record<string, number>>({})
  const [isMuted, setIsMuted] = useState(false)
  const [isDeafened, setIsDeafened] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isReceiving, setIsReceiving] = useState(false)
  const [speakingUserIds, setSpeakingUserIds] = useState<Set<string>>(new Set())
  const [voiceStats, setVoiceStats] = useState<VoiceStats | null>(null)
  const [voiceReconnecting, setVoiceReconnecting] = useState(false)
  // Voice channel currently being connected to — sidebar shows "connecting…"
  const [voiceConnectingChannelId, setVoiceConnectingChannelId] = useState<string | null>(null)
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false)
  const [messageSound, setMessageSound] = useState(() => loadUiSettings(auth.userId).messageSound)
  const messageSoundRef = useRef(messageSound)
  useEffect(() => { messageSoundRef.current = messageSound }, [messageSound])
  // Last polled stats, kept in a ref so disconnect logging can include them
  const lastVoiceStatsRef = useRef<VoiceStats | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [participantVolumes, setParticipantVolumes] = useState<Record<string, number>>({})
  const [participantVoiceState, setParticipantVoiceState] = useState<Record<string, { muted: boolean; deafened: boolean; videoEnabled: boolean; screenSharing: boolean }>>({})
  const [isCameraOn, setIsCameraOn] = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [videoTiles, setVideoTiles] = useState<VideoTile[]>([])
  const [streamViewUserId, setStreamViewUserId] = useState<string | null>(null)
  const [streamViewType, setStreamViewType] = useState<'screen' | 'camera'>('screen')
  const prevChannelRef = useRef<Channel | null>(null)
  const isDeafenedRef = useRef(false)
  const isMutedRef = useRef(false)
  const mutedByDeafenRef = useRef(false)
  const isCameraOnRef = useRef(false)
  const isScreenSharingRef = useRef(false)
  const screenShareAudioTrackRef = useRef<LocalAudioTrack | null>(null)

  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const intentionalDisconnectRef = useRef(false)
  const participantVolumesRef = useRef<Record<string, number>>({})

  // Voice settings state - persisted to localStorage keyed by userId
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pttMode, setPttMode] = useState(() => loadVoiceSettings(auth.userId).pttMode)
  const [pttKey, setPttKey] = useState(() => loadVoiceSettings(auth.userId).pttKey)
  const [outputVolume, setOutputVolume] = useState(() => loadVoiceSettings(auth.userId).outputVolume)
  const [noiseSuppression, setNoiseSuppression] = useState(() => loadVoiceSettings(auth.userId).noiseSuppression)
  const [echoCancellation, setEchoCancellation] = useState(() => loadVoiceSettings(auth.userId).echoCancellation)
  const [autoGainControl, setAutoGainControl] = useState(() => loadVoiceSettings(auth.userId).autoGainControl)
  const [selectedInputDevice, setSelectedInputDevice] = useState(() => loadVoiceSettings(auth.userId).selectedInputDevice)
  const [selectedOutputDevice, setSelectedOutputDevice] = useState(() => loadVoiceSettings(auth.userId).selectedOutputDevice)
  const [rnnoiseEnabled, setRnnoiseEnabled] = useState(() => loadVoiceSettings(auth.userId).rnnoiseEnabled)
  const [cameraQuality, setCameraQuality] = useState<CameraQuality>(() => loadVoiceSettings(auth.userId).cameraQuality)
  const [screenShareQuality, setScreenShareQuality] = useState<ScreenShareQuality>(() => loadVoiceSettings(auth.userId).screenShareQuality)
  const [screenShareAudio, setScreenShareAudio] = useState(() => loadVoiceSettings(auth.userId).screenShareAudio)
  const outputVolumeRef = useRef(1)
  const rnnoiseEnabledRef = useRef(false)
  const rnnoiseProcessorRef = useRef<RNNoiseProcessor | null>(null)
  const voiceChannelIdRef = useRef<string | null>(null)
  const voiceParticipantsRef = useRef<Record<string, string[]>>({})

  // Ctrl+Shift+F12 opens DevTools (hidden from users, available for debugging)
  useEffect(() => {
    if (!platform.isDesktop) return
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'F12') {
        ;(getCurrentWebviewWindow() as any).openDevtools()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Persist voice settings to localStorage whenever they change
  useEffect(() => {
    saveVoiceSettings(auth.userId, {
      pttMode, pttKey, outputVolume,
      noiseSuppression, echoCancellation, autoGainControl,
      selectedInputDevice, selectedOutputDevice, rnnoiseEnabled,
      cameraQuality, screenShareQuality, screenShareAudio,
    })
  }, [pttMode, pttKey, outputVolume, noiseSuppression, echoCancellation, autoGainControl,
    selectedInputDevice, selectedOutputDevice, rnnoiseEnabled,
    cameraQuality, screenShareQuality, screenShareAudio, auth.userId])

  // Keep refs in sync for use inside LiveKit event callbacks
  useEffect(() => { isDeafenedRef.current = isDeafened }, [isDeafened])
  useEffect(() => { isMutedRef.current = isMuted }, [isMuted])
  useEffect(() => { isCameraOnRef.current = isCameraOn }, [isCameraOn])
  useEffect(() => { isScreenSharingRef.current = isScreenSharing }, [isScreenSharing])
  useEffect(() => { outputVolumeRef.current = outputVolume }, [outputVolume])
  useEffect(() => { rnnoiseEnabledRef.current = rnnoiseEnabled }, [rnnoiseEnabled])
  useEffect(() => { activeChannelRef.current = activeChannel }, [activeChannel])
  useEffect(() => { voiceChannelIdRef.current = voiceChannelId }, [voiceChannelId])
  useEffect(() => { voiceParticipantsRef.current = voiceParticipants }, [voiceParticipants])
  useEffect(() => { participantVolumesRef.current = participantVolumes }, [participantVolumes])
  useEffect(() => { channelsRef.current = channels }, [channels])
  useEffect(() => { dmChannelsRef.current = dmChannels }, [dmChannels])
  useEffect(() => { mutedChannelIdsRef.current = mutedChannelIds }, [mutedChannelIds])
  useEffect(() => { windowFocusedRef.current = windowFocused }, [windowFocused])

  // Broadcast own rich presence activity whenever context changes
  useEffect(() => {
    if (!wsRef.current) return
    let activity = 'Online'
    if (voiceChannelId) {
      const ch = channels.find(c => c.id === voiceChannelId)
      activity = ch ? `Chatting in #${ch.name}` : 'In voice'
    } else if (windowFocused) {
      if (activeUtilityId === 'gandle') {
        activity = 'Doing the Gandle'
      } else if (activeUtilityId === 'library') {
        activity = 'Browsing the library'
      } else if (activeUtilityId === 'file-manager') {
        activity = 'Browsing files'
      } else if (activeChannel) {
        if (activeChannel.type !== 'DM') activity = `In #${activeChannel.name}`
      }
    }
    wsRef.current.send({ type: 'activity:update', payload: { activity } })
    setUserActivities(prev => ({ ...prev, [auth.userId]: activity }))
  }, [voiceChannelId, windowFocused, activeUtilityId, activeChannel, channels, auth.userId])

  // Auto-close stream view if the streamer stops sharing
  useEffect(() => {
    if (!streamViewUserId) return
    const isScreen = streamViewType === 'screen'
    const stillActive = videoTiles.some(t => t.participantId === streamViewUserId && t.isScreen === isScreen)
    if (!stillActive) handleCloseStream()
  // handleCloseStream is stable (no deps change its behaviour)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoTiles, streamViewUserId, streamViewType])

  // Notification setup: permission, Android notification channels, and
  // tap-on-notification → open that chat. handleNavigateToChannel closes over
  // state, so taps route through a ref; channels unknown at tap time (fresh
  // launch) are stashed and consumed after loadBaseData.
  const handleNavigateToChannelRef = useRef<(channelId: string) => void>(() => {})
  useEffect(() => { handleNavigateToChannelRef.current = handleNavigateToChannel })
  useEffect(() => {
    let cleanup: (() => void) | null = null
    initNotifications(channelId => {
      const known = [...channelsRef.current, ...dmChannelsRef.current].some(c => c.id === channelId)
      if (known) handleNavigateToChannelRef.current(channelId)
      else pendingNotificationChannelIdRef.current = channelId
    }).then(fn => { cleanup = fn })
    return () => { cleanup?.() }
  }, [])

  // Load notifications and check recovery setup on mount
  useEffect(() => {
    api.getNotifications(auth.token).then(setNotifications).catch(() => {})
    api.getRecoveryStatus(auth.token).then(({ hasRecovery }) => {
      if (!hasRecovery) setShowRecoverySetup(true)
    }).catch(() => {})
  }, [auth.token])

  // Update taskbar badge (desktop only)
  useEffect(() => {
    if (!platform.hasWindowBadge) return
    const unmuted = (id: string) => !mutedChannelIds.has(id)
    const totalUnread = Object.entries(unreadCounts).filter(([id]) => unmuted(id)).reduce((sum, [, n]) => sum + n, 0)
    const hasMention = Object.entries(mentionCounts).some(([id, n]) => unmuted(id) && n > 0)
    const win = getCurrentWindow()
    win.setBadgeCount(totalUnread > 0 ? totalUnread : undefined).catch(() => {})
    const badge = hasMention ? '@' : totalUnread >= 10 ? '!!' : totalUnread >= 1 ? '!' : null
    win.setTitle(badge ? `[${badge}] Gander` : 'Gander').catch(() => {})
    if (badge) {
      makeBadgeOverlay(badge).then(img => win.setOverlayIcon(img)).catch(() => {})
    } else {
      win.setOverlayIcon(undefined).catch(() => {})
    }
    // Mirror unread state on the tray tooltip so a hidden-to-tray window
    // still shows what's waiting
    if (platform.hasTray) {
      import('@tauri-apps/api/tray').then(({ TrayIcon }) =>
        TrayIcon.getById('main').then(tray =>
          tray?.setTooltip(
            totalUnread > 0
              ? `Gander — ${totalUnread} unread${hasMention ? ' (@)' : ''}`
              : 'Gander'
          )
        )
      ).catch(() => {})
    }
  }, [unreadCounts, mentionCounts, mutedChannelIds])

  // Load channels, DMs, users, and unread counts — with explicit loading/error
  // state so a failed fetch (flaky mobile network, server down) never leaves a
  // silently empty sidebar. Also re-run after every WS reconnect to catch up on
  // events missed while disconnected.
  async function loadBaseData() {
    setBaseLoading(true)
    setBaseError(null)
    try {
      const [fetchedChannels, dms, fetchedUsers, unreads] = await Promise.all([
        api.getChannels(auth.token),
        api.getDMs(auth.token),
        api.getUsers(auth.token),
        api.getUnreads(auth.token),
      ])
      setChannels(fetchedChannels)
      setDmChannels(dms)
      setUsers(fetchedUsers)
      if (fetchedChannels.length === 0) setShowChannelIndex(true)

      // Server is the single source of truth for read state and unread counts
      const counts: Record<string, number> = {}
      const mentions: Record<string, number> = {}
      const lrMap: Record<string, string> = {}
      for (const u of unreads) {
        if (u.lastReadAt) lrMap[u.channelId] = u.lastReadAt
        if (u.count > 0) counts[u.channelId] = u.count
        if (u.mentionCount > 0) mentions[u.channelId] = u.mentionCount
      }
      lastReadMapRef.current = lrMap
      // The channel currently on screen is being read — don't badge it, and
      // tell the server (covers refetch-after-reconnect races)
      const activeId = activeChannelRef.current?.id
      if (activeId) {
        delete counts[activeId]
        delete mentions[activeId]
        const now = new Date().toISOString()
        lastReadMapRef.current[activeId] = now
        api.markChannelsRead(auth.token, [{ channelId: activeId, lastReadAt: now }]).catch(() => {})
      }
      setUnreadCounts(counts)
      setMentionCounts(mentions)

      // A notification was tapped before channels were loaded — open it now
      const pendingId = pendingNotificationChannelIdRef.current
      if (pendingId) {
        pendingNotificationChannelIdRef.current = null
        const target = [...fetchedChannels, ...dms].find(c => c.id === pendingId)
        if (target) openChannel(target)
      }
    } catch (err) {
      setBaseError(err instanceof Error ? err.message : 'failed to load')
    } finally {
      setBaseLoading(false)
    }
  }

  useEffect(() => {
    loadBaseData()

    const ws = new GanderWS(auth.token)
    wsRef.current = ws

    setConnStatus(ws.status)
    const unsubStatus = ws.onStatus(setConnStatus)
    // Stale/invalid token or ban — reconnecting can't help, go back to login
    ws.onAuthFail(() => {
      localStorage.removeItem('gander_auth')
      onLogout()
    })
    const unsubReconnect = ws.onReconnect(() => { loadBaseData() })

    const unsub = ws.on(event => {
      if (event.type === 'users:init') {
        setOnlineUserIds(new Set(event.payload.onlineUserIds))
      } else if (event.type === 'user:online') {
        setOnlineUserIds(prev => new Set([...prev, event.payload.userId]))
        setUsers(prev => prev.some(u => u.id === event.payload.userId) ? prev : [...prev, event.payload.user])
      } else if (event.type === 'user:offline') {
        const { userId, lastSeenAt } = event.payload
        setOnlineUserIds(prev => {
          const next = new Set(prev)
          next.delete(userId)
          return next
        })
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, lastSeenAt } : u))
        setUserActivities(prev => { const n = { ...prev }; delete n[userId]; return n })
      } else if (event.type === 'message:new') {
        const { channelId, authorName, content, authorId, mentions } = event.payload
        const isActiveChannel = channelId === activeChannelRef.current?.id
        const isMuted = mutedChannelIdsRef.current.has(channelId)
        const isMentioned = mentions.includes(auth.userId)

        if (!isActiveChannel) {
          setUnreadCounts(prev => ({ ...prev, [channelId]: (prev[channelId] ?? 0) + 1 }))
          if (isMentioned) {
            setMentionCounts(prev => ({ ...prev, [channelId]: (prev[channelId] ?? 0) + 1 }))
          }
        }

        if (authorId !== auth.userId && !isMuted) {
          // Optional soft blip (settings toggle) — throttled inside playMessageBlip
          if (messageSoundRef.current && (!isActiveChannel || !windowFocusedRef.current)) {
            playMessageBlip()
          }
          const ch = [...channelsRef.current, ...dmChannelsRef.current].find(c => c.id === channelId)
          const channelLabel = ch?.type === 'DM' ? `@${authorName}` : `#${ch?.name ?? channelId}`
          const truncated = content.length > 120 ? content.slice(0, 120) + '…' : content
          if (platform.hasWindowBadge) {
            // Desktop: mentions always fire; regular messages only when unfocused
            if (isMentioned) {
              notifyMessage({ channelId, channelLabel, authorName, body: truncated, isMention: true })
            } else if (!isActiveChannel) {
              getCurrentWindow().isFocused().then(focused => {
                if (focused) return
                notifyMessage({ channelId, channelLabel, authorName, body: truncated, isMention: false })
              }).catch(() => {})
            }
          } else {
            // Android: document visibility is the attention signal. Regular
            // messages while the app is visible are suppressed (sidebar badges
            // and the blip cover them); mentions fire unless the user is
            // looking at that exact channel.
            const visible = isAppVisible()
            const shouldNotify = isMentioned
              ? !(visible && isActiveChannel)
              : !isActiveChannel && !visible
            if (shouldNotify) {
              notifyMessage({ channelId, channelLabel, authorName, body: truncated, isMention: isMentioned })
            }
          }
        }
      } else if (event.type === 'activity:init') {
        setUserActivities(event.payload.activities)
      } else if (event.type === 'activity:update') {
        setUserActivities(prev => ({ ...prev, [event.payload.userId]: event.payload.activity }))
      } else if (event.type === 'voice:init') {
        setVoiceParticipants(event.payload.voiceRooms)
        setParticipantVoiceState(event.payload.voiceStates)
        setVoiceChannelStartTimes(event.payload.voiceChannelStartTimes)
        // Re-register if WS dropped and reconnected while we were still in a LiveKit room
        if (voiceChannelIdRef.current && voiceRoomRef.current) {
          wsRef.current?.send({ type: 'voice:join', payload: { channelId: voiceChannelIdRef.current } })
          wsRef.current?.send({ type: 'voice:state', payload: { muted: isMutedRef.current, deafened: isDeafenedRef.current, videoEnabled: isCameraOnRef.current, screenSharing: isScreenSharingRef.current } })
        }
      } else if (event.type === 'voice:state') {
        const { userId, muted, deafened, videoEnabled, screenSharing } = event.payload
        setParticipantVoiceState(prev => ({ ...prev, [userId]: { muted, deafened, videoEnabled, screenSharing } }))
      } else if (event.type === 'voice:join') {
        const { userId, channelId, startTime } = event.payload
        setVoiceParticipants(prev => ({
          ...prev,
          [channelId]: [...(prev[channelId] ?? []).filter(id => id !== userId), userId],
        }))
        if (startTime !== undefined) {
          setVoiceChannelStartTimes(prev => ({ ...prev, [channelId]: startTime }))
        }
        // Honk when someone else joins the voice channel you're in
        if (userId !== auth.userId && channelId === voiceChannelIdRef.current) {
          playHonks((voiceParticipantsRef.current[channelId]?.length ?? 0) + 1)
        }
      } else if (event.type === 'voice:leave') {
        const { userId, channelId } = event.payload
        const remaining = (voiceParticipantsRef.current[channelId] ?? []).filter(id => id !== userId)
        setVoiceParticipants(prev => ({
          ...prev,
          [channelId]: remaining,
        }))
        setParticipantVoiceState(prev => { const next = { ...prev }; delete next[userId]; return next })
        if (remaining.length === 0) {
          setVoiceChannelStartTimes(prev => { const next = { ...prev }; delete next[channelId]; return next })
        }
      } else if (event.type === 'dm:new') {
        const channel = event.payload
        const isNew = !dmChannelsRef.current.some(c => c.id === channel.id)
        setDmChannels(prev => prev.some(c => c.id === channel.id) ? prev : [...prev, channel])
        if (isNew) {
          // Fetch unread count for this DM — catches messages sent while we were briefly disconnected
          api.getUnreadCounts(auth.token, { [channel.id]: new Date(0).toISOString() }).then(results => {
            for (const { channelId, count, mentionCount } of results) {
              if (count > 0) setUnreadCounts(prev => ({ ...prev, [channelId]: count }))
              if (mentionCount > 0) setMentionCounts(prev => ({ ...prev, [channelId]: mentionCount }))
            }
          })
        }
      } else if (event.type === 'channel:created') {
        const channel = event.payload
        setChannels(prev => prev.some(c => c.id === channel.id) ? prev : [...prev, channel])
      } else if (event.type === 'channel:updated') {
        const channel = event.payload
        setChannels(prev => prev.map(c => c.id === channel.id ? channel : c))
        setActiveChannel(prev => prev?.id === channel.id ? channel : prev)
      } else if (event.type === 'channel:deleted') {
        const { channelId } = event.payload
        setChannels(prev => prev.filter(c => c.id !== channelId))
        setActiveChannel(prev => prev?.id === channelId ? null : prev)
        setUnreadCounts(prev => { const next = { ...prev }; delete next[channelId]; return next })
        setMentionCounts(prev => { const next = { ...prev }; delete next[channelId]; return next })
      } else if (event.type === 'channel:removed') {
        // We lost membership (kicked, or left on another device) — prune the
        // channel instead of letting sends fail with not_member
        const { channelId, channelName, reason } = event.payload
        setChannels(prev => prev.filter(c => c.id !== channelId))
        setDmChannels(prev => prev.filter(c => c.id !== channelId))
        setActiveChannel(prev => prev?.id === channelId ? null : prev)
        setUnreadCounts(prev => { const next = { ...prev }; delete next[channelId]; return next })
        setMentionCounts(prev => { const next = { ...prev }; delete next[channelId]; return next })
        if (reason === 'kicked') {
          toast(`you were removed from #${channelName}`, { variant: 'error' })
        }
      } else if (event.type === 'user:updated') {
        const user = event.payload
        setUsers(prev => prev.map(u => u.id === user.id ? user : u))
        setProfileTarget(prev => prev && prev.user.id === user.id ? { ...prev, user } : prev)
        setFullProfileTarget(prev => prev?.id === user.id ? user : prev)
      } else if (event.type === 'channel:read') {
        // Another device/tab marked this channel read — sync local state
        const { channelId, lastReadAt } = event.payload
        const local = lastReadMapRef.current[channelId]
        if (!local || new Date(lastReadAt) > new Date(local)) {
          lastReadMapRef.current[channelId] = lastReadAt
        }
        setUnreadCounts(prev => { const next = { ...prev }; delete next[channelId]; return next })
        setMentionCounts(prev => { const next = { ...prev }; delete next[channelId]; return next })
        clearChannelNotification(channelId)
      } else if (event.type === 'user:banned') {
        const { userId } = event.payload
        if (userId === auth.userId) {
          localStorage.removeItem('gander_auth')
          onLogout()
        } else {
          setUsers(prev => prev.map(u => u.id === userId ? { ...u, isBanned: true } : u))
        }
      } else if (event.type === 'user:unbanned') {
        setUsers(prev => prev.map(u => u.id === event.payload.userId ? { ...u, isBanned: false } : u))
      } else if (event.type === 'user:timedout') {
        setUsers(prev => prev.map(u => u.id === event.payload.userId ? { ...u, timeoutUntil: event.payload.timeoutUntil } : u))
        if (event.payload.userId === auth.userId) {
          setErrorMessage(`you have been timed out until ${new Date(event.payload.timeoutUntil).toLocaleString()}`)
          // Timeouts also apply to voice — disconnect immediately (Disconnected
          // handler resets all voice state)
          const vcId = voiceChannelIdRef.current
          if (vcId && voiceRoomRef.current) {
            wsRef.current?.send({ type: 'voice:leave', payload: { channelId: vcId } })
            intentionalDisconnectRef.current = true
            voiceRoomRef.current.disconnect()
          }
        }
      } else if (event.type === 'user:untimeout') {
        setUsers(prev => prev.map(u => u.id === event.payload.userId ? { ...u, timeoutUntil: null } : u))
      } else if (event.type === 'user:role_changed') {
        const { userId, role } = event.payload
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u))
        if (userId === auth.userId) setCurrentUserRole(role)
      } else if (event.type === 'channel:archived') {
        const { channelId } = event.payload
        setChannels(prev => prev.map(c => c.id === channelId ? { ...c, isArchived: true } : c))
        if (activeChannelRef.current?.id === channelId) setActiveChannel(null)
      } else if (event.type === 'channel:visibility_changed') {
        const { channelId, visibility } = event.payload
        setChannels(prev => prev.map(c => c.id === channelId ? { ...c, visibility } : c))
      } else if (event.type === 'notification:new') {
        const n = event.payload
        const meta = (n.meta ?? {}) as { channelId?: string }
        // Mention while already looking at that channel with the window focused →
        // mark read immediately, like Discord
        if (n.type === 'mention' && meta.channelId && meta.channelId === activeChannelRef.current?.id && windowFocusedRef.current) {
          api.markNotificationRead(auth.token, n.id).catch(() => {})
          setNotifications(prev => [{ ...n, read: true }, ...prev])
        } else {
          setNotifications(prev => [n, ...prev])
          // Non-mention notifications (invites, password resets, …) also raise an
          // OS notification — mentions already get one via the message:new path.
          // On Android, skip it when the user is visibly looking at the channel
          // the notification is about.
          if (n.type !== 'mention') {
            const suppress = !platform.hasWindowBadge && isAppVisible()
              && !!meta.channelId && meta.channelId === activeChannelRef.current?.id
            if (!suppress) {
              notifySystem({ title: n.title, ...(n.body ? { body: n.body } : {}) })
            }
          }
        }
      } else if (event.type === 'user:archived') {
        const { userId } = event.payload
        if (userId === auth.userId) {
          localStorage.removeItem('gander_auth')
          onLogout()
        } else {
          setUsers(prev => prev.map(u => u.id === userId ? { ...u, isArchived: true } : u))
        }
      } else if (event.type === 'user:unarchived') {
        setUsers(prev => prev.map(u => u.id === event.payload.userId ? { ...u, isArchived: false } : u))
      }
    })

    return () => {
      unsub()
      unsubStatus()
      unsubReconnect()
      ws.close()
    }
  // loadBaseData and onLogout are stable for the lifetime of this auth session
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.token])

  // Track first successful connection so the banner doesn't flash during boot
  useEffect(() => {
    if (connStatus === 'online') setEverConnected(true)
  }, [connStatus])

  // On resume from background / network return, reconnect immediately instead
  // of waiting for the (possibly throttled) 3s retry timer — fixes the mobile
  // "app opens to a dead view" problem
  useEffect(() => {
    function wake() {
      if (document.visibilityState !== 'hidden') wsRef.current?.forceReconnect()
    }
    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        lastHiddenAtRef.current = Date.now()
        return
      }
      wsRef.current?.forceReconnect()
      // If the socket survived backgrounding, events may have been frozen while
      // the WebView was suspended — the reconnect handler won't fire, so refetch
      // explicitly after a long absence.
      const hiddenFor = lastHiddenAtRef.current ? Date.now() - lastHiddenAtRef.current : 0
      if (hiddenFor > 30_000 && wsRef.current?.status === 'online') loadBaseData()
      // The channel on screen is being read — drop its OS notification
      const activeId = activeChannelRef.current?.id
      if (activeId) clearChannelNotification(activeId)
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', wake)
    window.addEventListener('focus', wake)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', wake)
      window.removeEventListener('focus', wake)
    }
  // loadBaseData is stable for the lifetime of this auth session
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Disconnect from voice on unmount
  useEffect(() => {
    return () => { voiceRoomRef.current?.disconnect() }
  }, [])

  // Ctrl/Cmd+K — quick switcher (Discord-style)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setQuickSwitcherOpen(open => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Track window focus for rich presence. The tao focus event never fires on
  // Android (windowFocused would be stuck true forever, breaking presence,
  // the blip gate and mention auto-read) — use document visibility there.
  useEffect(() => {
    if (platform.isMobile) {
      const handler = () => setWindowFocused(isAppVisible())
      handler()
      document.addEventListener('visibilitychange', handler)
      return () => document.removeEventListener('visibilitychange', handler)
    }
    const win = getCurrentWindow()
    let unlistenFocus: (() => void) | null = null
    win.isFocused().then(focused => setWindowFocused(focused))
    win.onFocusChanged(({ payload: focused }) => setWindowFocused(focused)).then(fn => { unlistenFocus = fn })
    return () => { unlistenFocus?.() }
  }, [])

  // Send voice:leave + disconnect LiveKit before the Tauri window closes (desktop only)
  useEffect(() => {
    if (!platform.hasCloseEvent) return
    const win = getCurrentWindow()
    let unlisten: (() => void) | null = null

    win.onCloseRequested(async (event) => {
      event.preventDefault()
      if (voiceRoomRef.current && voiceChannelIdRef.current) {
        wsRef.current?.send({ type: 'voice:leave', payload: { channelId: voiceChannelIdRef.current } })
        intentionalDisconnectRef.current = true
        await voiceRoomRef.current.disconnect()
      }
      await win.close()
    }).then(fn => { unlisten = fn })

    return () => { unlisten?.() }
  }, [])

  // Push-to-talk press/release — shared by the keyboard handler (desktop)
  // and the on-screen hold-to-talk bar (touch)
  async function pttPress() {
    const room = voiceRoomRef.current
    if (!room) return
    await room.localParticipant.setMicrophoneEnabled(true, { noiseSuppression, echoCancellation, autoGainControl }, { audioPreset: AudioPresets.musicHighQualityStereo })
    // Apply RNNoise on first PTT press if enabled and not yet applied
    if (rnnoiseEnabledRef.current && !rnnoiseProcessorRef.current) {
      const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone)
      const track = pub?.track
      if (track instanceof LocalAudioTrack) {
        const proc = new RNNoiseProcessor()
        rnnoiseProcessorRef.current = proc
        await track.setProcessor(proc as never)
      }
    }
    setIsMuted(false)
    wsRef.current?.send({ type: 'voice:state', payload: { muted: false, deafened: false, videoEnabled: isCameraOnRef.current, screenSharing: isScreenSharingRef.current } })
  }

  async function pttRelease() {
    await voiceRoomRef.current?.localParticipant.setMicrophoneEnabled(false)
    setIsMuted(true)
    wsRef.current?.send({ type: 'voice:state', payload: { muted: true, deafened: false, videoEnabled: isCameraOnRef.current, screenSharing: isScreenSharingRef.current } })
  }

  // Push-to-talk keyboard handler
  useEffect(() => {
    if (!pttMode || !voiceChannelId) return
    const down = (e: KeyboardEvent) => {
      if (e.code !== pttKey || e.repeat) return
      void pttPress()
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== pttKey) return
      void pttRelease()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  // pttPress/pttRelease read their audio settings from the deps below
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pttMode, voiceChannelId, pttKey, noiseSuppression, echoCancellation, autoGainControl])

  async function handleJoinVoice(channel: Channel) {
    // Leave existing room first (if any)
    if (voiceRoomRef.current) {
      if (voiceChannelId) {
        wsRef.current?.send({ type: 'voice:leave', payload: { channelId: voiceChannelId } })
      }
      intentionalDisconnectRef.current = true
      await voiceRoomRef.current.disconnect()
      voiceRoomRef.current = null
    }

    setVoiceConnectingChannelId(channel.id)
    try {
      if (!navigator.mediaDevices) {
        setErrorMessage('microphone access is not available — check your system permissions for Gander')
        setVoiceConnectingChannelId(null)
        return
      }

      // Reset deafen state synchronously before registering TrackSubscribed —
      // the handler fires during room.connect() before React can re-render and
      // run the isDeafenedRef sync effect, so the ref must be correct in advance.
      isDeafenedRef.current = false
      setIsDeafened(false)

      const { token, url } = await api.getVoiceToken(auth.token, channel.id)
      vlog('joining', { channel: channel.name, url })
      const room = new Room({
        disconnectOnPageLeave: false,
        audioCaptureDefaults: { echoCancellation, noiseSuppression, autoGainControl, channelCount: 2, sampleRate: 48000 },
      })
      voiceRoomRef.current = room

      // Speaking indicators — use createAudioAnalyser (local Web Audio API) instead of
      // ActiveSpeakersChanged (server-driven, ~1s interval) for zero-latency response.
      const SPEAKING_THRESHOLD = 0.05
      type VolCalc = { calculateVolume: () => number; cleanup: () => Promise<void> }
      const remoteAnalysers = new Map<string, VolCalc>()
      let localAnalyser: VolCalc | null = null
      let speakingPollInterval: ReturnType<typeof setInterval> | null = null

      // Surface unexpected disconnects (after successful connect) via error modal
      room.on(RoomEvent.Disconnected, (reason) => {
        vlog('disconnected', {
          reason: reason !== undefined ? DisconnectReason[reason] ?? reason : 'undefined',
          intentional: intentionalDisconnectRef.current,
          lastStats: lastVoiceStatsRef.current,
        })
        if (!intentionalDisconnectRef.current && reason !== undefined) {
          setErrorMessage(`voice disconnected: ${disconnectReasonLabel(reason)}`)
        }
        intentionalDisconnectRef.current = false
        setVoiceReconnecting(false)
        lastVoiceStatsRef.current = null
        rnnoiseProcessorRef.current = null
        voiceRoomRef.current = null
        if (statsIntervalRef.current) { clearInterval(statsIntervalRef.current); statsIntervalRef.current = null }
        if (speakingPollInterval) { clearInterval(speakingPollInterval); speakingPollInterval = null }
        for (const a of remoteAnalysers.values()) a.cleanup().catch(() => {})
        remoteAnalysers.clear()
        localAnalyser?.cleanup().catch(() => {})
        localAnalyser = null
        setVoiceChannelId(null)
        setIsMuted(false)
        setIsDeafened(false)
        setIsSpeaking(false)
        setIsReceiving(false)
        setSpeakingUserIds(new Set())
        setVoiceStats(null)
        setSettingsOpen(false)
      })

      // Reconnect lifecycle — livekit-client retries automatically for a while
      // before giving up; without these handlers that window is silent dead air
      room.on(RoomEvent.SignalReconnecting, () => {
        vlog('signal reconnecting', { lastStats: lastVoiceStatsRef.current })
        setVoiceReconnecting(true)
      })
      room.on(RoomEvent.Reconnecting, () => {
        vlog('reconnecting (full)', { lastStats: lastVoiceStatsRef.current })
        setVoiceReconnecting(true)
      })
      room.on(RoomEvent.Reconnected, () => {
        vlog('reconnected')
        setVoiceReconnecting(false)
      })
      room.on(RoomEvent.MediaDevicesError, (err) => {
        vlog('media devices error', err)
      })

      // Attach incoming audio/video tracks
      room.on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach()
          document.body.appendChild(el)
          const multiplier = participantVolumesRef.current[participant.identity] ?? 1.0
          participant.setVolume(isDeafenedRef.current ? 0 : Math.min(2, outputVolumeRef.current * multiplier))
          try {
            remoteAnalysers.set(participant.identity, createAudioAnalyser(track as RemoteAudioTrack))
          } catch { /* ignore — browser may lack AudioContext support */ }
        } else if (track.kind === Track.Kind.Video) {
          const isScreen = pub.source === Track.Source.ScreenShare
          setVideoTiles(prev => {
            const filtered = prev.filter(t => !(t.participantId === participant.identity && t.isScreen === isScreen))
            return [...filtered, { participantId: participant.identity, track: track as RemoteVideoTrack, isScreen, isLocal: false }]
          })
        }
      })

      room.on(RoomEvent.TrackUnsubscribed, (track, pub, participant) => {
        if (track.kind === Track.Kind.Audio) {
          track.detach().forEach(el => el.remove())
          const a = remoteAnalysers.get(participant.identity)
          if (a) { a.cleanup().catch(() => {}); remoteAnalysers.delete(participant.identity) }
        } else if (track.kind === Track.Kind.Video) {
          const isScreen = pub.source === Track.Source.ScreenShare
          setVideoTiles(prev => prev.filter(t => !(t.participantId === participant.identity && t.isScreen === isScreen)))
        }
      })

      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        new Audio(hangupUrl).play().catch(() => {})
        const a = remoteAnalysers.get(participant.identity)
        if (a) { a.cleanup().catch(() => {}); remoteAnalysers.delete(participant.identity) }
      })

      // Local track published — mic analyser + video tile
      room.on(RoomEvent.LocalTrackPublished, (pub) => {
        if (pub.source === Track.Source.Microphone && pub.audioTrack) {
          try {
            localAnalyser?.cleanup().catch(() => {})
            localAnalyser = createAudioAnalyser(pub.audioTrack)
          } catch { /* ignore */ }
        } else if (pub.source === Track.Source.Camera && pub.videoTrack) {
          setVideoTiles(prev => {
            const filtered = prev.filter(t => !(t.participantId === room.localParticipant.identity && !t.isScreen))
            return [...filtered, { participantId: room.localParticipant.identity, track: pub.videoTrack as LocalVideoTrack, isScreen: false, isLocal: true }]
          })
        } else if (pub.source === Track.Source.ScreenShare && pub.videoTrack) {
          setVideoTiles(prev => {
            const filtered = prev.filter(t => !(t.participantId === room.localParticipant.identity && t.isScreen))
            return [...filtered, { participantId: room.localParticipant.identity, track: pub.videoTrack as LocalVideoTrack, isScreen: true, isLocal: true }]
          })
        }
      })
      room.on(RoomEvent.LocalTrackUnpublished, (pub) => {
        if (pub.source === Track.Source.Microphone) {
          localAnalyser?.cleanup().catch(() => {})
          localAnalyser = null
        } else if (pub.source === Track.Source.Camera) {
          setIsCameraOn(false)
          isCameraOnRef.current = false
          setVideoTiles(prev => prev.filter(t => !(t.participantId === room.localParticipant.identity && !t.isScreen)))
          wsRef.current?.send({ type: 'voice:state', payload: { muted: isMutedRef.current, deafened: isDeafenedRef.current, videoEnabled: false, screenSharing: isScreenSharingRef.current } })
        } else if (pub.source === Track.Source.ScreenShare) {
          setIsScreenSharing(false)
          isScreenSharingRef.current = false
          setVideoTiles(prev => prev.filter(t => !(t.participantId === room.localParticipant.identity && t.isScreen)))
          wsRef.current?.send({ type: 'voice:state', payload: { muted: isMutedRef.current, deafened: isDeafenedRef.current, videoEnabled: isCameraOnRef.current, screenSharing: false } })
          // Clean up separately-published screen share audio track if any
          const audioTrack = screenShareAudioTrackRef.current
          if (audioTrack) {
            room.localParticipant.unpublishTrack(audioTrack).catch(() => {})
            audioTrack.stop()
            screenShareAudioTrackRef.current = null
          }
        }
      })

      // Poll all analysers at 50ms (20fps) — purely local, no server round-trip.
      // Track last-set values so silent ticks don't schedule 20 renders/sec.
      let lastSpeaking = false
      let lastReceiving = false
      speakingPollInterval = setInterval(() => {
        const nowSpeaking = (localAnalyser?.calculateVolume() ?? 0) > SPEAKING_THRESHOLD
        if (nowSpeaking !== lastSpeaking) {
          lastSpeaking = nowSpeaking
          setIsSpeaking(nowSpeaking)
        }
        const speaking = new Set<string>()
        for (const [identity, { calculateVolume }] of remoteAnalysers) {
          if (calculateVolume() > SPEAKING_THRESHOLD) speaking.add(identity)
        }
        setSpeakingUserIds(prev =>
          prev.size === speaking.size && [...speaking].every(id => prev.has(id)) ? prev : speaking
        )
        const nowReceiving = speaking.size > 0
        if (nowReceiving !== lastReceiving) {
          lastReceiving = nowReceiving
          setIsReceiving(nowReceiving)
        }
      }, 50)

      await room.connect(url, token)
      await room.startAudio()
      vlog('connected', { channel: channel.name })

      setVoiceStats({ quality: 'unknown', ping: null, jitter: null, packetsLost: null })

      room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
        if (participant.identity !== room.localParticipant.identity) return
        const q = quality === ConnectionQuality.Excellent ? 'excellent'
          : quality === ConnectionQuality.Good ? 'good'
          : quality === ConnectionQuality.Poor ? 'poor'
          : 'unknown'
        vlog('connection quality', q, lastVoiceStatsRef.current ?? {})
        setVoiceStats(prev => prev ? { ...prev, quality: q } : null)
      })

      const pollStats = async () => {
        const r = voiceRoomRef.current
        if (!r) return
        const pub = r.localParticipant.getTrackPublication(Track.Source.Microphone)
        const sender = (pub?.track as LocalAudioTrack | undefined)?.sender
        if (!sender) return
        try {
          const stats = await sender.getStats()
          stats.forEach(report => {
            if (report.type === 'remote-inbound-rtp') {
              const s = report as { roundTripTime?: number; jitter?: number; fractionLost?: number }
              setVoiceStats(prev => {
                if (!prev) return null
                const next = {
                  ...prev,
                  ping: s.roundTripTime != null ? Math.round(s.roundTripTime * 1000) : prev.ping,
                  jitter: s.jitter != null ? Math.round(s.jitter * 1000) : prev.jitter,
                  packetsLost: s.fractionLost != null ? +(s.fractionLost * 100).toFixed(1) : prev.packetsLost,
                }
                lastVoiceStatsRef.current = next
                return next
              })
            }
          })
        } catch { /* ignore */ }
      }
      statsIntervalRef.current = setInterval(() => { pollStats().catch(() => {}) }, 3000)

      // Staggered honks: one for each person already in the channel, plus one for yourself
      playHonks((voiceParticipants[channel.id]?.length ?? 0) + 1)

      if (pttMode) {
        await room.localParticipant.setMicrophoneEnabled(false)
        setIsMuted(true)
      } else {
        await room.localParticipant.setMicrophoneEnabled(true, { noiseSuppression, echoCancellation, autoGainControl }, { audioPreset: AudioPresets.musicHighQualityStereo })
        setIsMuted(false)
        // Apply RNNoise if enabled
        if (rnnoiseEnabled) {
          const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone)
          const track = pub?.track
          if (track instanceof LocalAudioTrack) {
            const proc = new RNNoiseProcessor()
            rnnoiseProcessorRef.current = proc
            await track.setProcessor(proc as never)
          }
        }
      }

      wsRef.current?.send({ type: 'voice:join', payload: { channelId: channel.id } })
      setVoiceChannelId(channel.id)
      setVoiceConnectingChannelId(null)
    } catch (err) {
      vlog('connect failed', err)
      voiceRoomRef.current = null
      setVoiceConnectingChannelId(null)
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMessage(`voice connect failed: ${msg}`)
    }
  }

  async function handleLeaveVoice() {
    if (!voiceRoomRef.current || !voiceChannelId) return
    wsRef.current?.send({ type: 'voice:leave', payload: { channelId: voiceChannelId } })
    intentionalDisconnectRef.current = true
    await voiceRoomRef.current.disconnect()
    new Audio(hangupUrl).play().catch(() => {})
    rnnoiseProcessorRef.current = null
    voiceRoomRef.current = null
    setVoiceChannelId(null)
    setIsMuted(false)
    setIsDeafened(false)
    setIsCameraOn(false)
    setIsScreenSharing(false)
    setVideoTiles([])
    setIsSpeaking(false)
    setIsReceiving(false)
    setSpeakingUserIds(new Set())
    setSettingsOpen(false)
  }

  async function handleToggleMute() {
    const room = voiceRoomRef.current
    const next = !isMuted
    if (room) await room.localParticipant.setMicrophoneEnabled(!next)
    setIsMuted(next)
    // Unmuting while deafened also undeafens (Discord behaviour)
    if (!next && isDeafened) {
      setIsDeafened(false)
      if (room) {
        for (const p of room.remoteParticipants.values()) {
          const multiplier = participantVolumesRef.current[p.identity] ?? 1.0
          p.setVolume(Math.min(2, outputVolumeRef.current * multiplier))
        }
      }
      wsRef.current?.send({ type: 'voice:state', payload: { muted: next, deafened: false, videoEnabled: isCameraOnRef.current, screenSharing: isScreenSharingRef.current } })
    } else {
      wsRef.current?.send({ type: 'voice:state', payload: { muted: next, deafened: isDeafened, videoEnabled: isCameraOnRef.current, screenSharing: isScreenSharingRef.current } })
    }
  }

  async function handleToggleDeafen() {
    const room = voiceRoomRef.current
    const next = !isDeafened
    setIsDeafened(next)
    // Deafening also mutes mic; undeafening reverses that auto-mute
    let nextMuted = isMuted
    if (next && !isMuted) {
      if (room) await room.localParticipant.setMicrophoneEnabled(false)
      setIsMuted(true)
      isMutedRef.current = true
      nextMuted = true
      mutedByDeafenRef.current = true
    } else if (!next && mutedByDeafenRef.current) {
      if (room) await room.localParticipant.setMicrophoneEnabled(true)
      setIsMuted(false)
      isMutedRef.current = false
      nextMuted = false
      mutedByDeafenRef.current = false
    }
    if (room) {
      for (const p of room.remoteParticipants.values()) {
        const multiplier = participantVolumesRef.current[p.identity] ?? 1.0
        p.setVolume(next ? 0 : Math.min(2, outputVolumeRef.current * multiplier))
      }
    }
    wsRef.current?.send({ type: 'voice:state', payload: { muted: nextMuted, deafened: next, videoEnabled: isCameraOnRef.current, screenSharing: isScreenSharingRef.current } })
  }

  async function handleToggleCamera() {
    const room = voiceRoomRef.current
    if (!room) return
    const next = !isCameraOn
    const preset = cameraPreset(cameraQuality)
    await room.localParticipant.setCameraEnabled(
      next,
      { resolution: preset.resolution },
      { videoEncoding: preset.encoding },
    )
    setIsCameraOn(next)
    isCameraOnRef.current = next
    wsRef.current?.send({ type: 'voice:state', payload: { muted: isMutedRef.current, deafened: isDeafenedRef.current, videoEnabled: next, screenSharing: isScreenSharingRef.current } })
  }

  async function handleToggleScreenShare() {
    const room = voiceRoomRef.current
    if (!room) return

    if (isScreenSharing) {
      // Stop screen share
      try {
        await room.localParticipant.setScreenShareEnabled(false)
        setIsScreenSharing(false)
        isScreenSharingRef.current = false
        wsRef.current?.send({ type: 'voice:state', payload: { muted: isMutedRef.current, deafened: isDeafenedRef.current, videoEnabled: isCameraOnRef.current, screenSharing: false } })
      } catch (err) {
        throw err
      }
      return
    }

    // Start screen share
    // Intercept getDisplayMedia to separate audio from video: on Windows/WebView2,
    // audio track failure (driver issue, nothing playing, etc.) can end the entire
    // MediaStream including the video track. By stripping audio out before LiveKit
    // sees it and publishing it as a separate ScreenShareAudio track, audio failure
    // can't kill the video stream.
    const ssPreset = screenSharePreset(screenShareQuality)
    // Use an object so TypeScript doesn't narrow the property to `never` across
    // async closures — TS control-flow narrowing only applies to local `let` vars.
    const captured = { audioTrack: null as MediaStreamTrack | null }
    if (screenShareAudio) {
      const origGDM = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getDisplayMedia = async (constraints?: DisplayMediaStreamOptions) => {
        const stream = await origGDM({ ...constraints, audio: true })
        const audioTracks = stream.getAudioTracks()
        if (audioTracks.length > 0) {
          captured.audioTrack = audioTracks[0]
          stream.removeTrack(captured.audioTrack)
        }
        return stream
      }
      try {
        await room.localParticipant.setScreenShareEnabled(
          true,
          { resolution: ssPreset.resolution, audio: false },
          { screenShareEncoding: ssPreset.encoding },
        )
      } catch (err) {
        navigator.mediaDevices.getDisplayMedia = origGDM
        captured.audioTrack?.stop()
        if (err instanceof Error && err.name === 'NotAllowedError') return
        throw err
      }
      navigator.mediaDevices.getDisplayMedia = origGDM
      if (captured.audioTrack) {
        try {
          const lkAudioTrack = new LocalAudioTrack(captured.audioTrack, undefined, false)
          await room.localParticipant.publishTrack(lkAudioTrack, { source: Track.Source.ScreenShareAudio })
          screenShareAudioTrackRef.current = lkAudioTrack
        } catch {
          captured.audioTrack?.stop()
        }
      }
    } else {
      try {
        await room.localParticipant.setScreenShareEnabled(
          true,
          { resolution: ssPreset.resolution, audio: false },
          { screenShareEncoding: ssPreset.encoding },
        )
      } catch (err) {
        if (err instanceof Error && err.name === 'NotAllowedError') return
        throw err
      }
    }
    setIsScreenSharing(true)
    isScreenSharingRef.current = true
    wsRef.current?.send({ type: 'voice:state', payload: { muted: isMutedRef.current, deafened: isDeafenedRef.current, videoEnabled: isCameraOnRef.current, screenSharing: true } })
  }

  async function handleChangePttMode(ptt: boolean) {
    setPttMode(ptt)
    // Auto-mute when switching into PTT mode
    if (ptt && !isMuted && voiceRoomRef.current) {
      await voiceRoomRef.current.localParticipant.setMicrophoneEnabled(false)
      setIsMuted(true)
    }
  }

  function handleChangePttKey(code: string) {
    setPttKey(code)
  }

  function handleChangeOutputVolume(vol: number) {
    setOutputVolume(vol)
    outputVolumeRef.current = vol
    if (!isDeafened && voiceRoomRef.current) {
      for (const p of voiceRoomRef.current.remoteParticipants.values()) {
        const multiplier = participantVolumesRef.current[p.identity] ?? 1.0
        p.setVolume(Math.min(2, vol * multiplier))
      }
    }
  }

  function handleSetParticipantVolume(userId: string, multiplier: number) {
    setParticipantVolumes(prev => ({ ...prev, [userId]: multiplier }))
    participantVolumesRef.current = { ...participantVolumesRef.current, [userId]: multiplier }
    if (!isDeafened && voiceRoomRef.current) {
      const p = [...voiceRoomRef.current.remoteParticipants.values()].find(p => p.identity === userId)
      p?.setVolume(Math.min(2, outputVolumeRef.current * multiplier))
    }
  }

  async function handleSwitchInputDevice(deviceId: string) {
    setSelectedInputDevice(deviceId)
    await voiceRoomRef.current?.switchActiveDevice('audioinput', deviceId)
  }

  async function handleSwitchOutputDevice(deviceId: string) {
    setSelectedOutputDevice(deviceId)
    await voiceRoomRef.current?.switchActiveDevice('audiooutput', deviceId)
  }

  async function handleToggleRnnoise(enabled: boolean) {
    setRnnoiseEnabled(enabled)
    const room = voiceRoomRef.current
    if (!room) return
    const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone)
    const track = pub?.track
    if (!(track instanceof LocalAudioTrack)) return
    if (enabled) {
      const proc = new RNNoiseProcessor()
      rnnoiseProcessorRef.current = proc
      await track.setProcessor(proc as never)
    } else {
      await track.setProcessor(null as never)
      rnnoiseProcessorRef.current = null
    }
  }

  async function handleChangeAudioProcessing(ns: boolean, ec: boolean, agc: boolean) {
    setNoiseSuppression(ns)
    setEchoCancellation(ec)
    setAutoGainControl(agc)
    if (!voiceRoomRef.current || isMuted) return
    await voiceRoomRef.current.localParticipant.setMicrophoneEnabled(false)
    await voiceRoomRef.current.localParticipant.setMicrophoneEnabled(
      true,
      { noiseSuppression: ns, echoCancellation: ec, autoGainControl: agc },
      { audioPreset: AudioPresets.musicHighQualityStereo }
    )
  }

  async function handleCreateChannel(name: string, type: 'TEXT' | 'VOICE') {
    try {
      const channel = await api.createChannel(auth.token, name, type)
      setChannels(prev => prev.some(c => c.id === channel.id) ? prev : [...prev, channel])
      if (type === 'TEXT') setActiveChannel(channel)
      toast(`#${channel.name} created`, { variant: 'success' })
    } catch (err) {
      toastApiError(toast, err, "couldn't create channel")
    }
  }

  async function handleSetTopic(channelId: string, topic: string) {
    try {
      await api.setChannelTopic(auth.token, channelId, topic)
      // channel:updated WS broadcast updates channels + activeChannel state
    } catch (err) {
      toastApiError(toast, err, "couldn't set topic")
    }
  }

  function handleNavigateToChannel(channelId: string) {
    const ch = [...channels, ...dmChannels].find(c => c.id === channelId)
    if (!ch) return
    if (hiddenChannelIds.has(channelId)) {
      setHiddenChannelIds(prev => {
        const next = new Set(prev)
        next.delete(channelId)
        saveHidden(auth.userId, next)
        return next
      })
    }
    openChannel(ch)
  }

  async function handleRenameChannel(channelId: string, name: string) {
    try {
      const updated = await api.renameChannel(auth.token, channelId, name)
      setChannels(prev => prev.map(c => c.id === channelId ? updated : c))
      if (activeChannel?.id === channelId) setActiveChannel(updated)
    } catch (err) {
      toastApiError(toast, err, "couldn't rename channel")
    }
  }

  async function handleLeaveChannel(channelId: string) {
    try {
      await api.leaveChannel(auth.token, channelId)
      setChannels(prev => prev.filter(c => c.id !== channelId))
      if (activeChannel?.id === channelId) setActiveChannel(null)
      if (voiceChannelId === channelId) await handleLeaveVoice()
    } catch (err) {
      toastApiError(toast, err, "couldn't leave channel")
    }
  }

  async function handleArchiveChannel(channelId: string) {
    try {
      await api.archiveChannel(auth.token, channelId, true)
      setChannels(prev => prev.map(c => c.id === channelId ? { ...c, isArchived: true } : c))
      if (activeChannel?.id === channelId) setActiveChannel(null)
    } catch (err) {
      toastApiError(toast, err, "couldn't archive channel")
    }
  }

  async function handleDeleteChannel(channelId: string) {
    try {
      await api.deleteChannel(auth.token, channelId)
    } catch (err) {
      toastApiError(toast, err, "couldn't delete channel")
      return
    }
    setChannels(prev => prev.filter(c => c.id !== channelId))
    setDmChannels(prev => prev.filter(c => c.id !== channelId))
    if (activeChannel?.id === channelId) setActiveChannel(null)
    if (voiceChannelId === channelId) await handleLeaveVoice()
    setHiddenChannelIds(prev => {
      const next = new Set(prev)
      next.delete(channelId)
      saveHidden(auth.userId, next)
      return next
    })
    setUnreadCounts(prev => { const next = { ...prev }; delete next[channelId]; return next })
    setMentionCounts(prev => { const next = { ...prev }; delete next[channelId]; return next })
  }

  function markChannelRead(channelId: string) {
    setUnreadCounts(prev => { const next = { ...prev }; delete next[channelId]; return next })
    setMentionCounts(prev => { const next = { ...prev }; delete next[channelId]; return next })
    clearChannelNotification(channelId)
    const lastReadAt = new Date().toISOString()
    lastReadMapRef.current[channelId] = lastReadAt
    api.markChannelsRead(auth.token, [{ channelId, lastReadAt }]).catch(() => {})
  }

  function handleWatchStream(userId: string, type: 'screen' | 'camera') {
    prevChannelRef.current = activeChannel
    setStreamViewUserId(userId)
    setStreamViewType(type)
  }

  function handleCloseStream() {
    setStreamViewUserId(null)
    if (prevChannelRef.current) {
      setActiveChannel(prevChannelRef.current)
      prevChannelRef.current = null
    }
  }

  function openChannel(channel: Channel) {
    setPendingJump(null)
    // Snapshot the pre-open read marker BEFORE marking read, so the
    // "new messages" divider in ChannelView reflects what was actually unread
    setActiveChannelLastRead(lastReadMapRef.current[channel.id] ?? null)
    setActiveChannel(channel)
    setActiveUtilityId(null)
    markChannelRead(channel.id)
    setSidebarOpen(false)
  }

  function openUtility(id: 'library' | 'file-manager' | 'gandle' | 'admin') {
    setActiveUtilityId(id)
    setActiveChannel(null)
    setShowChannelIndex(false)
    setSidebarOpen(false)
  }

  async function handleJoinChannel(channelId: string, message?: string) {
    try {
      const result = await api.joinChannel(auth.token, channelId, message)
      if (result && typeof result === 'object' && 'status' in result && result.status === 'pending') {
        // SEMI_PUBLIC: request submitted, no immediate join
        return
      }
      // Refresh joined channels list
      const updated = await api.getChannels(auth.token)
      setChannels(updated)
      const joined = updated.find(c => c.id === channelId)
      if (joined) {
        setShowChannelIndex(false)
        openChannel(joined)
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to join channel')
    }
  }

  function handleToggleUtilityVisibility(id: string) {
    setHiddenUtilityIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      saveHiddenUtilities(auth.userId, next)
      return next
    })
  }

  function handleNavigateToMessage(channelId: string, messageId: string, createdAt: string) {
    const ch = [...channels, ...dmChannels].find(c => c.id === channelId)
    if (!ch) return
    if (hiddenChannelIds.has(channelId)) {
      setHiddenChannelIds(prev => {
        const next = new Set(prev)
        next.delete(channelId)
        saveHidden(auth.userId, next)
        return next
      })
    }
    setPendingJump({ messageId, anchorTime: createdAt })
    setActiveChannelLastRead(lastReadMapRef.current[channelId] ?? null)
    setActiveChannel(ch)
    markChannelRead(ch.id)
  }

  function handleNotificationClick(n: import('@gander/shared').Notification) {
    const meta = (n.meta ?? {}) as { channelId?: string; messageId?: string }
    if (meta.channelId && meta.messageId) {
      // Mention — jump straight to the message (notification time ≈ message time)
      handleNavigateToMessage(meta.channelId, meta.messageId, n.createdAt)
    } else if (meta.channelId) {
      // Channel invite etc. — open the channel
      handleNavigateToChannel(meta.channelId)
    }
  }

  function handleToggleMuted(channelId: string) {
    setMutedChannelIds(prev => {
      const next = new Set(prev)
      if (next.has(channelId)) next.delete(channelId)
      else next.add(channelId)
      saveMuted(auth.userId, next)
      return next
    })
  }

  function handleHideChannel(channelId: string) {
    setHiddenChannelIds(prev => {
      const next = new Set(prev)
      next.add(channelId)
      saveHidden(auth.userId, next)
      return next
    })
  }

  function handleToggleChannelVisibility(channelId: string) {
    setHiddenChannelIds(prev => {
      const next = new Set(prev)
      if (next.has(channelId)) next.delete(channelId)
      else next.add(channelId)
      saveHidden(auth.userId, next)
      return next
    })
  }

  // Left-click: open profile popup at cursor position
  function handleUserLeftClick(userId: string, x: number, y: number) {
    const user = users.find(u => u.id === userId)
    if (!user) return
    setProfileTarget({ user, x, y })
  }

  // Right-click: open context menu
  function handleUserRightClick(userId: string, x: number, y: number) {
    setUserContextMenu({ userId, x, y })
  }

  function handleOpenFullProfile(userId: string) {
    const user = users.find(u => u.id === userId)
    if (!user) return
    setFullProfileTarget(user)
  }

  async function handleStartDM(userId: string) {
    try {
      const channel = await api.startDM(auth.token, userId)
      setDmChannels(prev => {
        if (prev.some(c => c.id === channel.id)) return prev
        return [...prev, channel]
      })
      // Unhide if previously hidden
      setHiddenChannelIds(prev => {
        if (!prev.has(channel.id)) return prev
        const next = new Set(prev)
        next.delete(channel.id)
        saveHidden(auth.userId, next)
        return next
      })
      openChannel(channel)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMessage(`failed to open DM: ${msg}`)
    }
  }

  function handleHideDM(channelId: string) {
    setHiddenChannelIds(prev => {
      const next = new Set(prev)
      next.add(channelId)
      saveHidden(auth.userId, next)
      return next
    })
    if (activeChannel?.id === channelId) setActiveChannel(null)
  }

  function handleSubtitleUpdate(updated: User) {
    setUsers(prev => prev.map(u => u.id === updated.id ? updated : u))
    setProfileTarget(prev => prev && prev.user.id === updated.id ? { ...prev, user: updated } : prev)
    setFullProfileTarget(prev => prev?.id === updated.id ? updated : prev)
  }

  const updater = useAppUpdater()
  const androidUpdater = useAndroidUpdateCheck()
  const activeUpdater = platform.hasInAppUpdateCheck ? androidUpdater : updater
  const userContextMenuUser = userContextMenu ? users.find(u => u.id === userContextMenu.userId) : null

  return (
    <div className={styles.root}>
      {activeUpdater.visible && (
        <UpdateBanner
          state={activeUpdater.state}
          onInstall={activeUpdater.install}
          onDismiss={activeUpdater.dismiss}
        />
      )}
      {errorMessage && <ErrorModal message={errorMessage} onClose={() => setErrorMessage(null)} />}

      {connStatus !== 'online' && (everConnected || connStatus === 'offline') && (
        <div className={styles.connBanner} role="status" aria-live="polite">
          {connStatus === 'connecting' ? 'reconnecting to server…' : 'connection lost — retrying…'}
        </div>
      )}

      {voiceReconnecting && (
        <div className={styles.connBanner} role="status" aria-live="polite">voice connection interrupted — reconnecting…</div>
      )}

      {settingsOpen && (
        <SettingsModal
          displayName={auth.displayName}
          onLogout={onLogout}
          isMuted={isMuted}
          pttMode={pttMode}
          pttKey={pttKey}
          outputVolume={outputVolume}
          selectedInput={selectedInputDevice}
          selectedOutput={selectedOutputDevice}
          onToggleMute={handleToggleMute}
          onChangePttMode={handleChangePttMode}
          onChangePttKey={handleChangePttKey}
          onChangeOutputVolume={handleChangeOutputVolume}
          onSwitchInputDevice={handleSwitchInputDevice}
          onSwitchOutputDevice={handleSwitchOutputDevice}
          noiseSuppression={noiseSuppression}
          echoCancellation={echoCancellation}
          autoGainControl={autoGainControl}
          onChangeAudioProcessing={handleChangeAudioProcessing}
          rnnoiseEnabled={rnnoiseEnabled}
          rnnoiseSupported={rnnoiseSupported}
          onChangeRnnoise={handleToggleRnnoise}
          cameraQuality={cameraQuality}
          screenShareQuality={screenShareQuality}
          screenShareAudio={screenShareAudio}
          messageSound={messageSound}
          onChangeMessageSound={on => {
            setMessageSound(on)
            saveUiSettings(auth.userId, { messageSound: on })
          }}
          onChangeCameraQuality={setCameraQuality}
          onChangeScreenShareQuality={setScreenShareQuality}
          onChangeScreenShareAudio={setScreenShareAudio}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      <div className={styles.columns}>
      <Sidebar
        channels={channels}
        dmChannels={dmChannels}
        activeChannelId={activeChannel?.id ?? null}
        currentUserId={auth.userId}
        hiddenChannelIds={hiddenChannelIds}
        unreadCounts={unreadCounts}
        mentionCounts={mentionCounts}
        mutedChannelIds={mutedChannelIds}
        users={users}
        onlineUserIds={onlineUserIds}
        voiceChannelId={voiceChannelId}
        voiceParticipants={voiceParticipants}
        voiceChannelStartTimes={voiceChannelStartTimes}
        isMuted={isMuted}
        isDeafened={isDeafened}
        isSpeaking={isSpeaking}
        isReceiving={isReceiving}
        speakingUserIds={speakingUserIds}
        onSelectChannel={openChannel}
        onCreateChannel={handleCreateChannel}
        onRenameChannel={handleRenameChannel}
        onDeleteChannel={handleDeleteChannel}
        onArchiveChannel={handleArchiveChannel}
        onLeaveChannel={handleLeaveChannel}
        onHideChannel={handleHideChannel}
        onToggleChannelVisibility={handleToggleChannelVisibility}
        onMarkRead={markChannelRead}
        onToggleMuted={handleToggleMuted}
        onJoinVoice={handleJoinVoice}
        onLeaveVoice={handleLeaveVoice}
        onToggleMute={handleToggleMute}
        onToggleDeafen={handleToggleDeafen}
        isCameraOn={isCameraOn}
        isScreenSharing={isScreenSharing}
        onToggleCamera={handleToggleCamera}
        onToggleScreenShare={handleToggleScreenShare}
        voiceStats={voiceStats}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenDM={openChannel}
        onHideDM={handleHideDM}
        onSetTopic={handleSetTopic}
        displayName={auth.displayName}
        participantVolumes={participantVolumes}
        onSetParticipantVolume={handleSetParticipantVolume}
        participantVoiceState={participantVoiceState}
        onWatchStream={handleWatchStream}
        isOpen={sidebarOpen}
        onOpen={() => setSidebarOpen(true)}
        onClose={() => setSidebarOpen(false)}
        onOpenQuickSwitcher={() => { setSidebarOpen(false); setQuickSwitcherOpen(true) }}
        pttEnabled={pttMode}
        onPttDown={() => { void pttPress() }}
        onPttUp={() => { void pttRelease() }}
        hiddenUtilityIds={hiddenUtilityIds}
        onToggleUtilityVisibility={handleToggleUtilityVisibility}
        onOpenUtility={openUtility}
        activeUtilityId={activeUtilityId}
        onBrowseChannels={() => { setShowChannelIndex(true); setActiveChannel(null); setActiveUtilityId(null); setSidebarOpen(false) }}
        currentUserRole={currentUserRole}
        token={auth.token}
        notifications={notifications}
        onMarkNotificationRead={id => setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))}
        onMarkAllNotificationsRead={() => setNotifications(prev => prev.map(n => ({ ...n, read: true })))}
        onNotificationClick={handleNotificationClick}
        onInvitePeople={setInviteTarget}
        channelsLoading={baseLoading}
        channelsError={baseError}
        onRetryChannels={loadBaseData}
        voiceConnectingChannelId={voiceConnectingChannelId}
      />
      <main className={styles.content}>
        <button
          type="button"
          className={styles.hamburger}
          onClick={() => setSidebarOpen(true)}
          aria-label="open navigation"
        >
          [≡]
        </button>
        <button
          type="button"
          className={styles.socialToggle}
          onClick={() => setSocialOpen(true)}
          aria-label="open members"
        >
          [@]
        </button>
        {(() => {
          const isScreenType = streamViewType === 'screen'
          const activeTile = streamViewUserId
            ? videoTiles.find(t => t.participantId === streamViewUserId && t.isScreen === isScreenType) ?? null
            : null
          const floatingCamTiles = isScreenType
            ? videoTiles.filter(t => !t.isScreen)
            : videoTiles.filter(t => !t.isScreen && t.participantId !== streamViewUserId)
          const streamerName = streamViewUserId
            ? (users.find(u => u.id === streamViewUserId)?.displayName ?? streamViewUserId)
            : ''

          if (streamViewUserId && activeTile) {
            return (
              <StreamView
                screenTile={activeTile}
                cameraTiles={floatingCamTiles}
                users={users}
                currentUserId={auth.userId}
                streamerName={streamerName}
                streamType={streamViewType}
                streamVolume={participantVolumes[streamViewUserId] ?? 1}
                onSetStreamVolume={vol => handleSetParticipantVolume(streamViewUserId, vol)}
                onClose={handleCloseStream}
              />
            )
          }

          if (activeUtilityId === 'library') {
            return <LibraryView token={auth.token} />
          }

          if (activeUtilityId === 'file-manager') {
            return <FileManagerView token={auth.token} />
          }

          if (activeUtilityId === 'gandle') {
            return <GandleView token={auth.token} currentUserId={auth.userId} />
          }

          if (activeUtilityId === 'admin') {
            return (
              <AdminPanel
                token={auth.token}
                currentUserId={auth.userId}
                currentUserRole={currentUserRole}
              />
            )
          }

          if (showChannelIndex) {
            return (
              <ChannelIndexPage
                token={auth.token}
                currentUserId={auth.userId}
                joinedChannelIds={new Set(channels.map(c => c.id))}
                onJoin={handleJoinChannel}
                onOpen={openChannel}
                onJoinVoice={handleJoinVoice}
                onInvite={setInviteTarget}
                onClose={channels.length > 0 ? () => setShowChannelIndex(false) : undefined}
              />
            )
          }

          if (activeChannel && wsRef.current) {
            return (
              <ChannelView
                // Include the jump target so navigating to a message in the
                // already-open channel remounts and anchor-loads around it —
                // the target may be far outside the loaded message window
                key={`${activeChannel.id}:${pendingJump?.messageId ?? ''}`}
                channel={activeChannel}
                token={auth.token}
                ws={wsRef.current}
                users={users}
                channels={channels}
                currentUserId={auth.userId}
                currentUserRole={currentUserRole}
                onUserRightClick={handleUserRightClick}
                lastReadAt={activeChannelLastRead}
                onMarkRead={() => markChannelRead(activeChannel.id)}
                onNavigateToChannel={handleNavigateToChannel}
                onNavigateToUtility={openUtility}
                jumpToMessageId={pendingJump?.messageId ?? null}
                jumpAnchorTime={pendingJump?.anchorTime ?? null}
                onNavigateToMessage={handleNavigateToMessage}
              />
            )
          }

          return <p className={styles.placeholder}>select a channel or <button type="button" onClick={() => setShowChannelIndex(true)} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', padding: 0, textDecoration: 'underline' }}>[browse channels]</button></p>
        })()}
      </main>
      <SocialPanel
        users={users.filter(u => !u.isArchived)}
        onlineUserIds={onlineUserIds}
        userActivities={userActivities}
        onUserClick={handleUserLeftClick}
        onUserRightClick={handleUserRightClick}
        token={auth.token}
        onNavigateToMessage={(channelId, messageId, createdAt) => {
          setSocialOpen(false)
          handleNavigateToMessage(channelId, messageId, createdAt)
        }}
        isOpen={socialOpen}
        onOpen={() => setSocialOpen(true)}
        onClose={() => setSocialOpen(false)}
      />
      </div>
      {profileTarget && (
        <UserProfilePopup
          user={profileTarget.user}
          x={profileTarget.x}
          y={profileTarget.y}
          isOnline={onlineUserIds.has(profileTarget.user.id)}
          isOwnProfile={profileTarget.user.id === auth.userId}
          token={auth.token}
          onSubtitleUpdate={handleSubtitleUpdate}
          onClose={() => setProfileTarget(null)}
        />
      )}
      {fullProfileTarget && (
        <UserProfileModal
          user={fullProfileTarget}
          isOnline={onlineUserIds.has(fullProfileTarget.id)}
          isOwnProfile={fullProfileTarget.id === auth.userId}
          token={auth.token}
          onSubtitleUpdate={handleSubtitleUpdate}
          onAvatarUpdate={handleSubtitleUpdate}
          onClose={() => setFullProfileTarget(null)}
        />
      )}
      {userContextMenu && userContextMenuUser && (
        <ContextMenu
          x={userContextMenu.x}
          y={userContextMenu.y}
          items={(() => {
            const items: Array<{ label: string; danger?: boolean; action: () => void }> = [
              { label: 'open full profile', action: () => { handleOpenFullProfile(userContextMenu.userId); setUserContextMenu(null) } },
            ]
            if (userContextMenu.userId !== auth.userId) {
              items.push({
                label: 'direct message',
                action: () => { handleStartDM(userContextMenu.userId); setUserContextMenu(null) },
              })
              // Channel management on the active channel (Discord-style member actions)
              const ch = activeChannel
              const isModRole = ['MODERATOR', 'ADMIN', 'SUPERADMIN', 'ROOT'].includes(currentUserRole)
              const canManageActive = !!ch && ch.type !== 'DM' && ch.type !== 'GROUP' &&
                (isModRole || ch.creatorId === auth.userId || ch.memberRole === 'MANAGER')
              if (ch && canManageActive) {
                const targetId = userContextMenu.userId
                if (isModRole || ch.creatorId === auth.userId) {
                  items.push({
                    label: `make manager of #${ch.name}`,
                    action: async () => {
                      setUserContextMenu(null)
                      try {
                        await api.setChannelMemberRole(auth.token, ch.id, targetId, 'MANAGER')
                        toast(`${userContextMenuUser.displayName} is now a manager of #${ch.name}`, { variant: 'success' })
                      } catch (err) {
                        toastApiError(toast, err, "couldn't change member role")
                      }
                    },
                  })
                }
                items.push({
                  label: `kick from #${ch.name}`,
                  danger: true,
                  action: async () => {
                    setUserContextMenu(null)
                    try {
                      await api.kickChannelMember(auth.token, ch.id, targetId)
                      toast(`${userContextMenuUser.displayName} removed from #${ch.name}`, { variant: 'success' })
                    } catch (err) {
                      toastApiError(toast, err, "couldn't kick member")
                    }
                  },
                })
              }
            }
            return items
          })()}
          onClose={() => setUserContextMenu(null)}
        />
      )}
      {quickSwitcherOpen && (
        <QuickSwitcher
          channels={channels}
          dmChannels={dmChannels}
          users={users}
          currentUserId={auth.userId}
          unreadCounts={unreadCounts}
          onSelectChannel={ch => {
            if (ch.type === 'VOICE') void handleJoinVoice(ch)
            else handleNavigateToChannel(ch.id)
          }}
          onSelectUser={userId => void handleStartDM(userId)}
          onClose={() => setQuickSwitcherOpen(false)}
        />
      )}
      {showRecoverySetup && (
        <RecoverySetupModal
          token={auth.token}
          onDone={() => setShowRecoverySetup(false)}
          onSkip={() => setShowRecoverySetup(false)}
        />
      )}
      {inviteTarget && (
        <InvitePeopleModal
          token={auth.token}
          channel={inviteTarget}
          users={users}
          currentUserId={auth.userId}
          onClose={() => setInviteTarget(null)}
        />
      )}
    </div>
  )
}
