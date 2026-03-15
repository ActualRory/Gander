import { useEffect, useRef, useState } from 'react'
import goosehonkUrl from '../../sounds/goosehonk1.mp3?url'
import hangupUrl from '../../sounds/goosebell_hangup1.mp3?url'
import { Room, RoomEvent, Track, AudioPresets, VideoPresets, ScreenSharePresets, LocalAudioTrack, ConnectionQuality, createAudioAnalyser, type RemoteAudioTrack, type RemoteVideoTrack, type LocalVideoTrack } from 'livekit-client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { Image as TauriImage } from '@tauri-apps/api/image'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { platform } from '../lib/platform.ts'
import type { Channel, User } from '@gander/shared'
import type { AuthState } from '../App.tsx'
import { api } from '../lib/api.ts'
import { GanderWS } from '../lib/ws.ts'
import Sidebar from '../components/Sidebar.tsx'
import ChannelView from '../components/ChannelView.tsx'
import SocialPanel from '../components/SocialPanel.tsx'
import ErrorModal from '../components/ErrorModal.tsx'
import SettingsModal from '../components/SettingsModal.tsx'
import type { VoiceStats } from '../components/VoiceControls.tsx'
import type { CameraQuality, ScreenShareQuality } from '../components/SettingsModal.tsx'
import { type VideoTile } from '../components/VideoGrid.tsx'
import StreamView from '../components/StreamView.tsx'
import UserProfilePopup from '../components/UserProfilePopup.tsx'
import UserProfileModal from '../components/UserProfileModal.tsx'
import ContextMenu from '../components/ContextMenu.tsx'
import { RNNoiseProcessor, rnnoiseSupported } from '../lib/rnnoiseProcessor.ts'
import UpdateBanner from '../components/UpdateBanner.tsx'
import { useAppUpdater } from '../lib/useAppUpdater.ts'
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

function loadMuted(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`gander:muted:${userId}`)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch { return new Set() }
}

function saveMuted(userId: string, muted: Set<string>) {
  localStorage.setItem(`gander:muted:${userId}`, JSON.stringify([...muted]))
}

function loadLastRead(userId: string, channelId: string): string | null {
  return localStorage.getItem(`gander:lastread:${userId}:${channelId}`)
}

function saveLastRead(userId: string, channelId: string) {
  localStorage.setItem(`gander:lastread:${userId}:${channelId}`, new Date().toISOString())
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

export default function Main({ auth, onLogout }: Props) {
  const [channels, setChannels] = useState<Channel[]>([])
  const [dmChannels, setDmChannels] = useState<Channel[]>([])
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set())
  const [hiddenChannelIds, setHiddenChannelIds] = useState<Set<string>>(() => loadHidden(auth.userId))
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})
  const [mentionCounts, setMentionCounts] = useState<Record<string, number>>({})
  const [mutedChannelIds, setMutedChannelIds] = useState<Set<string>>(() => loadMuted(auth.userId))
  const [profileTarget, setProfileTarget] = useState<{ user: User; x: number; y: number } | null>(null)
  const [fullProfileTarget, setFullProfileTarget] = useState<User | null>(null)
  const [userContextMenu, setUserContextMenu] = useState<{ userId: string; x: number; y: number } | null>(null)
  const [pendingJump, setPendingJump] = useState<{ messageId: string; anchorTime: string } | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const wsRef = useRef<GanderWS | null>(null)
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

  // Auto-close stream view if the streamer stops sharing
  useEffect(() => {
    if (!streamViewUserId) return
    const isScreen = streamViewType === 'screen'
    const stillActive = videoTiles.some(t => t.participantId === streamViewUserId && t.isScreen === isScreen)
    if (!stillActive) handleCloseStream()
  // handleCloseStream is stable (no deps change its behaviour)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoTiles, streamViewUserId, streamViewType])

  // Request notification permission on mount
  useEffect(() => {
    isPermissionGranted().then(granted => {
      if (!granted) requestPermission().catch(() => {})
    }).catch(() => {})
  }, [])

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
  }, [unreadCounts, mentionCounts, mutedChannelIds])

  useEffect(() => {
    api.getChannels(auth.token).then(async fetchedChannels => {
      setChannels(fetchedChannels)
      // Bootstrap unread counts for text channels
      const channelLastReadAt: Record<string, string> = {}
      for (const c of fetchedChannels) {
        if (c.type !== 'TEXT') continue
        const lastRead = loadLastRead(auth.userId, c.id)
        if (lastRead) channelLastReadAt[c.id] = lastRead
      }
      if (Object.keys(channelLastReadAt).length > 0) {
        const results = await api.getUnreadCounts(auth.token, channelLastReadAt)
        const counts: Record<string, number> = {}
        const mentions: Record<string, number> = {}
        for (const { channelId, count, mentionCount } of results) {
          if (count > 0) counts[channelId] = count
          if (mentionCount > 0) mentions[channelId] = mentionCount
        }
        setUnreadCounts(counts)
        setMentionCounts(mentions)
      }
    })

    api.getDMs(auth.token).then(async dms => {
      setDmChannels(dms)
      // Bootstrap unread counts for DM channels — always include every DM.
      // For channels with no lastRead (never opened), use epoch so all messages count.
      const dmLastReadAt: Record<string, string> = {}
      for (const c of dms) {
        const lastRead = loadLastRead(auth.userId, c.id)
        dmLastReadAt[c.id] = lastRead ?? new Date(0).toISOString()
      }
      if (Object.keys(dmLastReadAt).length > 0) {
        const results = await api.getUnreadCounts(auth.token, dmLastReadAt)
        setUnreadCounts(prev => {
          const counts = { ...prev }
          for (const { channelId, count } of results) {
            if (count > 0) counts[channelId] = count
          }
          return counts
        })
        setMentionCounts(prev => {
          const mentions = { ...prev }
          for (const { channelId, mentionCount } of results) {
            if (mentionCount > 0) mentions[channelId] = mentionCount
          }
          return mentions
        })
      }
    })

    api.getUsers(auth.token).then(setUsers)

    const ws = new GanderWS(auth.token)
    wsRef.current = ws

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

        // Desktop notification: mentions always fire (unless muted); regular only when unfocused
        if (authorId !== auth.userId && !isMuted) {
          const ch = [...channelsRef.current, ...dmChannelsRef.current].find(c => c.id === channelId)
          const channelName = ch?.type === 'DM' ? `@${authorName}` : `#${ch?.name ?? channelId}`
          const truncated = content.length > 120 ? content.slice(0, 120) + '…' : content
          if (isMentioned) {
            sendNotification({ title: `${channelName} · ${authorName} mentioned you`, body: truncated })
          } else if (!isActiveChannel) {
            if (platform.hasWindowBadge) {
              getCurrentWindow().isFocused().then(focused => {
                if (focused) return
                sendNotification({ title: `${channelName} · ${authorName}`, body: truncated })
              }).catch(() => {})
            } else {
              sendNotification({ title: `${channelName} · ${authorName}`, body: truncated })
            }
          }
        }
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
      } else if (event.type === 'user:updated') {
        const user = event.payload
        setUsers(prev => prev.map(u => u.id === user.id ? user : u))
        setProfileTarget(prev => prev && prev.user.id === user.id ? { ...prev, user } : prev)
        setFullProfileTarget(prev => prev?.id === user.id ? user : prev)
      }
    })

    return () => {
      unsub()
      ws.close()
    }
  }, [auth.token])

  // Disconnect from voice on unmount
  useEffect(() => {
    return () => { voiceRoomRef.current?.disconnect() }
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

  // Push-to-talk keyboard handler
  useEffect(() => {
    if (!pttMode || !voiceChannelId) return
    const down = async (e: KeyboardEvent) => {
      if (e.code !== pttKey || e.repeat) return
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
    const up = async (e: KeyboardEvent) => {
      if (e.code !== pttKey) return
      await voiceRoomRef.current?.localParticipant.setMicrophoneEnabled(false)
      setIsMuted(true)
      wsRef.current?.send({ type: 'voice:state', payload: { muted: true, deafened: false, videoEnabled: isCameraOnRef.current, screenSharing: isScreenSharingRef.current } })
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
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

    try {
      // Reset deafen state synchronously before registering TrackSubscribed —
      // the handler fires during room.connect() before React can re-render and
      // run the isDeafenedRef sync effect, so the ref must be correct in advance.
      isDeafenedRef.current = false
      setIsDeafened(false)

      const { token, url } = await api.getVoiceToken(auth.token, channel.id)
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
        if (!intentionalDisconnectRef.current && reason !== undefined) {
          setErrorMessage(`voice disconnected: ${reason}`)
        }
        intentionalDisconnectRef.current = false
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

      // Poll all analysers at 50ms (20fps) — purely local, no server round-trip
      speakingPollInterval = setInterval(() => {
        setIsSpeaking((localAnalyser?.calculateVolume() ?? 0) > SPEAKING_THRESHOLD)
        const speaking = new Set<string>()
        for (const [identity, { calculateVolume }] of remoteAnalysers) {
          if (calculateVolume() > SPEAKING_THRESHOLD) speaking.add(identity)
        }
        setSpeakingUserIds(prev =>
          prev.size === speaking.size && [...speaking].every(id => prev.has(id)) ? prev : speaking
        )
        setIsReceiving(speaking.size > 0)
      }, 50)

      await room.connect(url, token)
      await room.startAudio()

      setVoiceStats({ quality: 'unknown', ping: null, jitter: null, packetsLost: null })

      room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
        if (participant.identity !== room.localParticipant.identity) return
        const q = quality === ConnectionQuality.Excellent ? 'excellent'
          : quality === ConnectionQuality.Good ? 'good'
          : quality === ConnectionQuality.Poor ? 'poor'
          : 'unknown'
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
              setVoiceStats(prev => prev ? {
                ...prev,
                ping: s.roundTripTime != null ? Math.round(s.roundTripTime * 1000) : prev.ping,
                jitter: s.jitter != null ? Math.round(s.jitter * 1000) : prev.jitter,
                packetsLost: s.fractionLost != null ? +(s.fractionLost * 100).toFixed(1) : prev.packetsLost,
              } : null)
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
    } catch (err) {
      console.error('Failed to join voice channel:', err)
      voiceRoomRef.current = null
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
    // Deafening also mutes mic
    let nextMuted = isMuted
    if (next && !isMuted) {
      if (room) await room.localParticipant.setMicrophoneEnabled(false)
      setIsMuted(true)
      nextMuted = true
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
    try {
      const ssPreset = screenSharePreset(screenShareQuality)
      await room.localParticipant.setScreenShareEnabled(
        true,
        { resolution: ssPreset.resolution, audio: screenShareAudio },
        { screenShareEncoding: ssPreset.encoding },
      )
      setIsScreenSharing(true)
      isScreenSharingRef.current = true
      wsRef.current?.send({ type: 'voice:state', payload: { muted: isMutedRef.current, deafened: isDeafenedRef.current, videoEnabled: isCameraOnRef.current, screenSharing: true } })
    } catch (err) {
      if (err instanceof Error && err.name === 'NotAllowedError') return
      throw err
    }
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
    const channel = await api.createChannel(auth.token, name, type)
    if (type === 'TEXT') setActiveChannel(channel)
  }

  async function handleSetTopic(channelId: string, topic: string) {
    await api.setChannelTopic(auth.token, channelId, topic)
    // channel:updated WS broadcast updates channels + activeChannel state
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
    const updated = await api.renameChannel(auth.token, channelId, name)
    setChannels(prev => prev.map(c => c.id === channelId ? updated : c))
    if (activeChannel?.id === channelId) setActiveChannel(updated)
  }

  async function handleDeleteChannel(channelId: string) {
    await api.deleteChannel(auth.token, channelId)
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
    saveLastRead(auth.userId, channelId)
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
    setActiveChannel(channel)
    markChannelRead(channel.id)
    setSidebarOpen(false)
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
    setActiveChannel(ch)
    markChannelRead(ch.id)
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
  const userContextMenuUser = userContextMenu ? users.find(u => u.id === userContextMenu.userId) : null

  return (
    <div className={styles.root}>
      {updater.visible && (
        <UpdateBanner
          state={updater.state}
          onInstall={updater.install}
          onDismiss={updater.dismiss}
        />
      )}
      {errorMessage && <ErrorModal message={errorMessage} onClose={() => setErrorMessage(null)} />}

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
        onClose={() => setSidebarOpen(false)}

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

          if (activeChannel && wsRef.current) {
            return (
              <ChannelView
                key={activeChannel.id}
                channel={activeChannel}
                token={auth.token}
                ws={wsRef.current}
                users={users}
                channels={channels}
                currentUserId={auth.userId}
                onUserRightClick={handleUserRightClick}
                lastReadAt={loadLastRead(auth.userId, activeChannel.id)}
                onMarkRead={() => markChannelRead(activeChannel.id)}
                onNavigateToChannel={handleNavigateToChannel}
                jumpToMessageId={pendingJump?.messageId ?? null}
                jumpAnchorTime={pendingJump?.anchorTime ?? null}
                onNavigateToMessage={handleNavigateToMessage}
              />
            )
          }

          return <p className={styles.placeholder}>select a channel</p>
        })()}
      </main>
      <SocialPanel
        users={users}
        onlineUserIds={onlineUserIds}
        voiceParticipants={voiceParticipants}
        onUserClick={handleUserLeftClick}
        onUserRightClick={handleUserRightClick}
        token={auth.token}
        onNavigateToMessage={handleNavigateToMessage}
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
          items={[
            { label: 'open full profile', action: () => { handleOpenFullProfile(userContextMenu.userId); setUserContextMenu(null) } },
            ...(userContextMenu.userId !== auth.userId ? [{
              label: 'direct message',
              action: () => { handleStartDM(userContextMenu.userId); setUserContextMenu(null) },
            }] : []),
          ]}
          onClose={() => setUserContextMenu(null)}
        />
      )}
    </div>
  )
}
