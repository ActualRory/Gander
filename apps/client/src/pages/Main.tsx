import { useEffect, useRef, useState } from 'react'
import { Room, RoomEvent, Track, ParticipantEvent } from 'livekit-client'
import type { Channel, User } from '@gander/shared'
import type { AuthState } from '../App.tsx'
import { api } from '../lib/api.ts'
import { GanderWS } from '../lib/ws.ts'
import Sidebar from '../components/Sidebar.tsx'
import ChannelView from '../components/ChannelView.tsx'
import SocialPanel from '../components/SocialPanel.tsx'
import ErrorModal from '../components/ErrorModal.tsx'
import VoiceSettingsModal from '../components/VoiceSettingsModal.tsx'
import styles from './Main.module.css'

interface Props {
  auth: AuthState
  onLogout: () => void
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

export default function Main({ auth, onLogout }: Props) {
  const [channels, setChannels] = useState<Channel[]>([])
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set())
  const [hiddenChannelIds, setHiddenChannelIds] = useState<Set<string>>(() => loadHidden(auth.userId))
  const wsRef = useRef<GanderWS | null>(null)

  // Voice state
  const voiceRoomRef = useRef<Room | null>(null)
  const [voiceChannelId, setVoiceChannelId] = useState<string | null>(null)
  const [voiceParticipants, setVoiceParticipants] = useState<Record<string, string[]>>({})
  const [isMuted, setIsMuted] = useState(false)
  const [isDeafened, setIsDeafened] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isReceiving, setIsReceiving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const isDeafenedRef = useRef(false)

  // Voice settings state
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pttMode, setPttMode] = useState(false)
  const [pttKey, setPttKey] = useState('Space')
  const [outputVolume, setOutputVolume] = useState(1)
  const outputVolumeRef = useRef(1)

  // Keep refs in sync for use inside LiveKit event callbacks
  useEffect(() => { isDeafenedRef.current = isDeafened }, [isDeafened])
  useEffect(() => { outputVolumeRef.current = outputVolume }, [outputVolume])

  useEffect(() => {
    api.getChannels(auth.token).then(setChannels)
    api.getUsers(auth.token).then(setUsers)

    const ws = new GanderWS(auth.token)
    wsRef.current = ws

    const unsub = ws.on(event => {
      if (event.type === 'users:init') {
        setOnlineUserIds(new Set(event.payload.onlineUserIds))
      } else if (event.type === 'user:online') {
        setOnlineUserIds(prev => new Set([...prev, event.payload.userId]))
      } else if (event.type === 'user:offline') {
        setOnlineUserIds(prev => {
          const next = new Set(prev)
          next.delete(event.payload.userId)
          return next
        })
      } else if (event.type === 'voice:init') {
        setVoiceParticipants(event.payload.voiceRooms)
      } else if (event.type === 'voice:join') {
        const { userId, channelId } = event.payload
        setVoiceParticipants(prev => ({
          ...prev,
          [channelId]: [...(prev[channelId] ?? []).filter(id => id !== userId), userId],
        }))
      } else if (event.type === 'voice:leave') {
        const { userId, channelId } = event.payload
        setVoiceParticipants(prev => ({
          ...prev,
          [channelId]: (prev[channelId] ?? []).filter(id => id !== userId),
        }))
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

  // Push-to-talk keyboard handler
  useEffect(() => {
    if (!pttMode || !voiceChannelId) return
    const down = async (e: KeyboardEvent) => {
      if (e.code !== pttKey || e.repeat) return
      await voiceRoomRef.current?.localParticipant.setMicrophoneEnabled(true)
      setIsMuted(false)
    }
    const up = async (e: KeyboardEvent) => {
      if (e.code !== pttKey) return
      await voiceRoomRef.current?.localParticipant.setMicrophoneEnabled(false)
      setIsMuted(true)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [pttMode, voiceChannelId, pttKey])

  async function handleJoinVoice(channel: Channel) {
    // Leave existing room first (if any)
    if (voiceRoomRef.current) {
      if (voiceChannelId) {
        wsRef.current?.send({ type: 'voice:leave', payload: { channelId: voiceChannelId } })
      }
      await voiceRoomRef.current.disconnect()
      voiceRoomRef.current = null
    }

    try {
      const { token, url } = await api.getVoiceToken(auth.token, channel.id)
      const room = new Room({ disconnectOnPageLeave: false })
      voiceRoomRef.current = room

      // Surface unexpected disconnects (after successful connect) via error modal
      room.on(RoomEvent.Disconnected, (reason) => {
        if (reason !== undefined) {
          setErrorMessage(`voice disconnected: ${reason}`)
        }
        voiceRoomRef.current = null
        setVoiceChannelId(null)
        setIsMuted(false)
        setIsDeafened(false)
        setIsSpeaking(false)
        setIsReceiving(false)
        setSettingsOpen(false)
      })

      // Apply volume and deafen state to newly subscribed tracks
      room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (track.kind === Track.Kind.Audio) {
          participant.setVolume(isDeafenedRef.current ? 0 : outputVolumeRef.current)
        }
      })

      // Speaking indicators
      room.localParticipant.on(ParticipantEvent.IsSpeakingChanged, (speaking: boolean) => {
        setIsSpeaking(speaking)
      })
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        setIsReceiving(speakers.some(p => p.identity !== room.localParticipant.identity))
      })

      await room.connect(url, token)

      if (pttMode) {
        await room.localParticipant.setMicrophoneEnabled(false)
        setIsMuted(true)
      } else {
        await room.localParticipant.setMicrophoneEnabled(true)
        setIsMuted(false)
      }

      wsRef.current?.send({ type: 'voice:join', payload: { channelId: channel.id } })
      setVoiceChannelId(channel.id)
      setIsDeafened(false)
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
    await voiceRoomRef.current.disconnect()
    voiceRoomRef.current = null
    setVoiceChannelId(null)
    setIsMuted(false)
    setIsDeafened(false)
    setIsSpeaking(false)
    setIsReceiving(false)
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
      for (const p of room.remoteParticipants.values()) p.setVolume(outputVolumeRef.current)
    }
  }

  async function handleToggleDeafen() {
    const room = voiceRoomRef.current
    if (!room) return
    const next = !isDeafened
    setIsDeafened(next)
    // Deafening also mutes mic
    if (next && !isMuted) {
      await room.localParticipant.setMicrophoneEnabled(false)
      setIsMuted(true)
    }
    for (const p of room.remoteParticipants.values()) {
      p.setVolume(next ? 0 : outputVolumeRef.current)
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
      for (const p of voiceRoomRef.current.remoteParticipants.values()) p.setVolume(vol)
    }
  }

  async function handleSwitchInputDevice(deviceId: string) {
    await voiceRoomRef.current?.switchActiveDevice('audioinput', deviceId)
  }

  async function handleSwitchOutputDevice(deviceId: string) {
    await voiceRoomRef.current?.switchActiveDevice('audiooutput', deviceId)
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
    if (activeChannel?.id === channelId) setActiveChannel(null)
    if (voiceChannelId === channelId) await handleLeaveVoice()
    setHiddenChannelIds(prev => {
      const next = new Set(prev)
      next.delete(channelId)
      saveHidden(auth.userId, next)
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

  return (
    <div className={styles.root}>
      {errorMessage && <ErrorModal message={errorMessage} onClose={() => setErrorMessage(null)} />}
      {settingsOpen && voiceRoomRef.current && (
        <VoiceSettingsModal
          isMuted={isMuted}
          pttMode={pttMode}
          pttKey={pttKey}
          outputVolume={outputVolume}
          onToggleMute={handleToggleMute}
          onChangePttMode={handleChangePttMode}
          onChangePttKey={handleChangePttKey}
          onChangeOutputVolume={handleChangeOutputVolume}
          onSwitchInputDevice={handleSwitchInputDevice}
          onSwitchOutputDevice={handleSwitchOutputDevice}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      <Sidebar
        channels={channels}
        activeChannelId={activeChannel?.id ?? null}
        currentUserId={auth.userId}
        hiddenChannelIds={hiddenChannelIds}
        users={users}
        voiceChannelId={voiceChannelId}
        voiceParticipants={voiceParticipants}
        isMuted={isMuted}
        isDeafened={isDeafened}
        isSpeaking={isSpeaking}
        isReceiving={isReceiving}
        onSelectChannel={setActiveChannel}
        onCreateChannel={handleCreateChannel}
        onRenameChannel={handleRenameChannel}
        onDeleteChannel={handleDeleteChannel}
        onHideChannel={handleHideChannel}
        onToggleChannelVisibility={handleToggleChannelVisibility}
        onJoinVoice={handleJoinVoice}
        onLeaveVoice={handleLeaveVoice}
        onToggleMute={handleToggleMute}
        onToggleDeafen={handleToggleDeafen}
        onOpenVoiceSettings={() => setSettingsOpen(true)}
        displayName={auth.displayName}
        onLogout={onLogout}
      />
      <main className={styles.content}>
        {activeChannel && wsRef.current ? (
          <ChannelView
            key={activeChannel.id}
            channel={activeChannel}
            token={auth.token}
            ws={wsRef.current}
          />
        ) : (
          <p className={styles.placeholder}>select a channel</p>
        )}
      </main>
      <SocialPanel users={users} onlineUserIds={onlineUserIds} />
    </div>
  )
}
