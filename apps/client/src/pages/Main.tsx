import { useEffect, useRef, useState } from 'react'
import goosehonkUrl from '../../sounds/goosehonk1.mp3?url'
import hangupUrl from '../../sounds/goosebell_hangup1.mp3?url'
import { Room, RoomEvent, Track, AudioPresets, LocalAudioTrack, ConnectionQuality, createAudioAnalyser, type RemoteAudioTrack } from 'livekit-client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Image as TauriImage } from '@tauri-apps/api/image'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import type { Channel, User } from '@gander/shared'
import type { AuthState } from '../App.tsx'
import { api } from '../lib/api.ts'
import { GanderWS } from '../lib/ws.ts'
import Sidebar from '../components/Sidebar.tsx'
import ChannelView from '../components/ChannelView.tsx'
import SocialPanel from '../components/SocialPanel.tsx'
import ErrorModal from '../components/ErrorModal.tsx'
import VoiceSettingsModal from '../components/VoiceSettingsModal.tsx'
import type { VoiceStats } from '../components/VoiceControls.tsx'
import UserProfilePopup from '../components/UserProfilePopup.tsx'
import UserProfileModal from '../components/UserProfileModal.tsx'
import ContextMenu from '../components/ContextMenu.tsx'
import { RNNoiseProcessor, rnnoiseSupported } from '../lib/rnnoiseProcessor.ts'
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
  const [mutedChannelIds, setMutedChannelIds] = useState<Set<string>>(() => loadMuted(auth.userId))
  const [profileTarget, setProfileTarget] = useState<{ user: User; x: number; y: number } | null>(null)
  const [fullProfileTarget, setFullProfileTarget] = useState<User | null>(null)
  const [userContextMenu, setUserContextMenu] = useState<{ userId: string; x: number; y: number } | null>(null)
  const wsRef = useRef<GanderWS | null>(null)
  const activeChannelRef = useRef<Channel | null>(null)
  const channelsRef = useRef<Channel[]>([])
  const dmChannelsRef = useRef<Channel[]>([])
  const mutedChannelIdsRef = useRef<Set<string>>(new Set())

  // Voice state
  const voiceRoomRef = useRef<Room | null>(null)
  const [voiceChannelId, setVoiceChannelId] = useState<string | null>(null)
  const [voiceParticipants, setVoiceParticipants] = useState<Record<string, string[]>>({})
  const [isMuted, setIsMuted] = useState(false)
  const [isDeafened, setIsDeafened] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isReceiving, setIsReceiving] = useState(false)
  const [speakingUserIds, setSpeakingUserIds] = useState<Set<string>>(new Set())
  const [voiceStats, setVoiceStats] = useState<VoiceStats | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [participantVolumes, setParticipantVolumes] = useState<Record<string, number>>({})
  const [participantVoiceState, setParticipantVoiceState] = useState<Record<string, { muted: boolean; deafened: boolean }>>({})
  const isDeafenedRef = useRef(false)
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
  const outputVolumeRef = useRef(1)
  const rnnoiseEnabledRef = useRef(false)
  const rnnoiseProcessorRef = useRef<RNNoiseProcessor | null>(null)
  const voiceChannelIdRef = useRef<string | null>(null)
  const voiceParticipantsRef = useRef<Record<string, string[]>>({})

  // Persist voice settings to localStorage whenever they change
  useEffect(() => {
    saveVoiceSettings(auth.userId, {
      pttMode, pttKey, outputVolume,
      noiseSuppression, echoCancellation, autoGainControl,
      selectedInputDevice, selectedOutputDevice, rnnoiseEnabled,
    })
  }, [pttMode, pttKey, outputVolume, noiseSuppression, echoCancellation, autoGainControl,
    selectedInputDevice, selectedOutputDevice, rnnoiseEnabled, auth.userId])

  // Keep refs in sync for use inside LiveKit event callbacks
  useEffect(() => { isDeafenedRef.current = isDeafened }, [isDeafened])
  useEffect(() => { outputVolumeRef.current = outputVolume }, [outputVolume])
  useEffect(() => { rnnoiseEnabledRef.current = rnnoiseEnabled }, [rnnoiseEnabled])
  useEffect(() => { activeChannelRef.current = activeChannel }, [activeChannel])
  useEffect(() => { voiceChannelIdRef.current = voiceChannelId }, [voiceChannelId])
  useEffect(() => { voiceParticipantsRef.current = voiceParticipants }, [voiceParticipants])
  useEffect(() => { participantVolumesRef.current = participantVolumes }, [participantVolumes])
  useEffect(() => { channelsRef.current = channels }, [channels])
  useEffect(() => { dmChannelsRef.current = dmChannels }, [dmChannels])
  useEffect(() => { mutedChannelIdsRef.current = mutedChannelIds }, [mutedChannelIds])

  // Request notification permission on mount
  useEffect(() => {
    isPermissionGranted().then(granted => {
      if (!granted) requestPermission().catch(() => {})
    }).catch(() => {})
  }, [])

  // Update taskbar badge
  useEffect(() => {
    const total = Object.entries(unreadCounts)
      .filter(([id]) => !mutedChannelIds.has(id))
      .reduce((sum, [, n]) => sum + n, 0)
    const win = getCurrentWindow()
    win.setBadgeCount(total > 0 ? total : undefined).catch(() => {})
    const badge = total >= 10 ? '!!' : total >= 1 ? '!' : null
    win.setTitle(badge ? `[${badge}] Gander` : 'Gander').catch(() => {})
    if (badge) {
      makeBadgeOverlay(badge).then(img => win.setOverlayIcon(img)).catch(() => {})
    } else {
      win.setOverlayIcon(undefined).catch(() => {})
    }
  }, [unreadCounts, mutedChannelIds])

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
        for (const { channelId, count } of results) {
          if (count > 0) counts[channelId] = count
        }
        setUnreadCounts(counts)
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
        const { channelId, authorName, content, authorId } = event.payload
        if (channelId !== activeChannelRef.current?.id) {
          setUnreadCounts(prev => ({ ...prev, [channelId]: (prev[channelId] ?? 0) + 1 }))
          if (authorId !== auth.userId && !mutedChannelIdsRef.current.has(channelId)) {
            getCurrentWindow().isFocused().then(focused => {
              if (focused) return
              const ch = [...channelsRef.current, ...dmChannelsRef.current].find(c => c.id === channelId)
              const channelName = ch?.type === 'DM' ? `@${authorName}` : `#${ch?.name ?? channelId}`
              const truncated = content.length > 120 ? content.slice(0, 120) + '…' : content
              sendNotification({ title: `${channelName} · ${authorName}`, body: truncated })
            }).catch(() => {})
          }
        }
      } else if (event.type === 'voice:init') {
        setVoiceParticipants(event.payload.voiceRooms)
        setParticipantVoiceState(event.payload.voiceStates)
      } else if (event.type === 'voice:state') {
        const { userId, muted, deafened } = event.payload
        setParticipantVoiceState(prev => ({ ...prev, [userId]: { muted, deafened } }))
      } else if (event.type === 'voice:join') {
        const { userId, channelId } = event.payload
        setVoiceParticipants(prev => ({
          ...prev,
          [channelId]: [...(prev[channelId] ?? []).filter(id => id !== userId), userId],
        }))
        // Honk when someone else joins the voice channel you're in
        if (userId !== auth.userId && channelId === voiceChannelIdRef.current) {
          playHonks((voiceParticipantsRef.current[channelId]?.length ?? 0) + 1)
        }
      } else if (event.type === 'voice:leave') {
        const { userId, channelId } = event.payload
        setVoiceParticipants(prev => ({
          ...prev,
          [channelId]: (prev[channelId] ?? []).filter(id => id !== userId),
        }))
        setParticipantVoiceState(prev => { const next = { ...prev }; delete next[userId]; return next })
      } else if (event.type === 'dm:new') {
        const channel = event.payload
        const isNew = !dmChannelsRef.current.some(c => c.id === channel.id)
        setDmChannels(prev => prev.some(c => c.id === channel.id) ? prev : [...prev, channel])
        if (isNew) {
          // Fetch unread count for this DM — catches messages sent while we were briefly disconnected
          api.getUnreadCounts(auth.token, { [channel.id]: new Date(0).toISOString() }).then(results => {
            for (const { channelId, count } of results) {
              if (count > 0) setUnreadCounts(prev => ({ ...prev, [channelId]: count }))
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

  // Send voice:leave + disconnect LiveKit before the Tauri window closes
  useEffect(() => {
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
      wsRef.current?.send({ type: 'voice:state', payload: { muted: false, deafened: false } })
    }
    const up = async (e: KeyboardEvent) => {
      if (e.code !== pttKey) return
      await voiceRoomRef.current?.localParticipant.setMicrophoneEnabled(false)
      setIsMuted(true)
      wsRef.current?.send({ type: 'voice:state', payload: { muted: true, deafened: false } })
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

      // Attach incoming audio tracks to the DOM and create analysers for speaking detection
      room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach()
          document.body.appendChild(el)
          const multiplier = participantVolumesRef.current[participant.identity] ?? 1.0
          participant.setVolume(isDeafenedRef.current ? 0 : Math.min(2, outputVolumeRef.current * multiplier))
          try {
            remoteAnalysers.set(participant.identity, createAudioAnalyser(track as RemoteAudioTrack))
          } catch { /* ignore — browser may lack AudioContext support */ }
        }
      })

      room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
        if (track.kind === Track.Kind.Audio) {
          track.detach().forEach(el => el.remove())
          const a = remoteAnalysers.get(participant.identity)
          if (a) { a.cleanup().catch(() => {}); remoteAnalysers.delete(participant.identity) }
        }
      })

      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        new Audio(hangupUrl).play().catch(() => {})
        const a = remoteAnalysers.get(participant.identity)
        if (a) { a.cleanup().catch(() => {}); remoteAnalysers.delete(participant.identity) }
      })

      // Local mic analyser — set up when the mic track is published
      room.on(RoomEvent.LocalTrackPublished, (pub) => {
        if (pub.source === Track.Source.Microphone && pub.audioTrack) {
          try {
            localAnalyser?.cleanup().catch(() => {})
            localAnalyser = createAudioAnalyser(pub.audioTrack)
          } catch { /* ignore */ }
        }
      })
      room.on(RoomEvent.LocalTrackUnpublished, (pub) => {
        if (pub.source === Track.Source.Microphone) {
          localAnalyser?.cleanup().catch(() => {})
          localAnalyser = null
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
    setIsSpeaking(false)
    setIsReceiving(false)
    setSpeakingUserIds(new Set())
    setSettingsOpen(false)
  }

  async function handleToggleMute() {
    const room = voiceRoomRef.current
    if (!room) return
    const next = !isMuted
    await room.localParticipant.setMicrophoneEnabled(!next)
    setIsMuted(next)
    // Unmuting while deafened also undeafens (Discord behaviour)
    if (!next && isDeafened) {
      setIsDeafened(false)
      for (const p of room.remoteParticipants.values()) {
        const multiplier = participantVolumesRef.current[p.identity] ?? 1.0
        p.setVolume(Math.min(2, outputVolumeRef.current * multiplier))
      }
      wsRef.current?.send({ type: 'voice:state', payload: { muted: next, deafened: false } })
    } else {
      wsRef.current?.send({ type: 'voice:state', payload: { muted: next, deafened: isDeafened } })
    }
  }

  async function handleToggleDeafen() {
    const room = voiceRoomRef.current
    if (!room) return
    const next = !isDeafened
    setIsDeafened(next)
    // Deafening also mutes mic
    let nextMuted = isMuted
    if (next && !isMuted) {
      await room.localParticipant.setMicrophoneEnabled(false)
      setIsMuted(true)
      nextMuted = true
    }
    for (const p of room.remoteParticipants.values()) {
      const multiplier = participantVolumesRef.current[p.identity] ?? 1.0
      p.setVolume(next ? 0 : Math.min(2, outputVolumeRef.current * multiplier))
    }
    wsRef.current?.send({ type: 'voice:state', payload: { muted: nextMuted, deafened: next } })
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
    setChannels(prev => [...prev, channel])
    if (type === 'TEXT') setActiveChannel(channel)
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
  }

  function markChannelRead(channelId: string) {
    setUnreadCounts(prev => { const next = { ...prev }; delete next[channelId]; return next })
    saveLastRead(auth.userId, channelId)
  }

  function openChannel(channel: Channel) {
    setActiveChannel(channel)
    markChannelRead(channel.id)
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

  const userContextMenuUser = userContextMenu ? users.find(u => u.id === userContextMenu.userId) : null

  return (
    <div className={styles.root}>
      {errorMessage && <ErrorModal message={errorMessage} onClose={() => setErrorMessage(null)} />}
      {settingsOpen && voiceRoomRef.current && (
        <VoiceSettingsModal
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
          onClose={() => setSettingsOpen(false)}
        />
      )}
      <Sidebar
        channels={channels}
        dmChannels={dmChannels}
        activeChannelId={activeChannel?.id ?? null}
        currentUserId={auth.userId}
        hiddenChannelIds={hiddenChannelIds}
        unreadCounts={unreadCounts}
        mutedChannelIds={mutedChannelIds}
        users={users}
        onlineUserIds={onlineUserIds}
        voiceChannelId={voiceChannelId}
        voiceParticipants={voiceParticipants}
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
        voiceStats={voiceStats}
        onOpenVoiceSettings={() => setSettingsOpen(true)}
        onOpenDM={openChannel}
        onHideDM={handleHideDM}
        displayName={auth.displayName}
        onLogout={onLogout}
        participantVolumes={participantVolumes}
        onSetParticipantVolume={handleSetParticipantVolume}
        participantVoiceState={participantVoiceState}
      />
      <main className={styles.content}>
        {activeChannel && wsRef.current ? (
          <ChannelView
            key={activeChannel.id}
            channel={activeChannel}
            token={auth.token}
            ws={wsRef.current}
            users={users}
            currentUserId={auth.userId}
            onUserRightClick={handleUserRightClick}
            lastReadAt={loadLastRead(auth.userId, activeChannel.id)}
            onMarkRead={() => markChannelRead(activeChannel.id)}
          />
        ) : (
          <p className={styles.placeholder}>select a channel</p>
        )}
      </main>
      <SocialPanel
        users={users}
        onlineUserIds={onlineUserIds}
        voiceParticipants={voiceParticipants}
        onUserClick={handleUserLeftClick}
        onUserRightClick={handleUserRightClick}
      />
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
