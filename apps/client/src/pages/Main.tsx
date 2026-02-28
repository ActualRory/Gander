import { useEffect, useRef, useState } from 'react'
import type { Channel, User } from '@gander/shared'
import type { AuthState } from '../App.tsx'
import { api } from '../lib/api.ts'
import { GanderWS } from '../lib/ws.ts'
import Sidebar from '../components/Sidebar.tsx'
import ChannelView from '../components/ChannelView.tsx'
import SocialPanel from '../components/SocialPanel.tsx'
import styles from './Main.module.css'

interface Props {
  auth: AuthState
  onLogout: () => void
}

export default function Main({ auth, onLogout }: Props) {
  const [channels, setChannels] = useState<Channel[]>([])
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set())
  const wsRef = useRef<GanderWS | null>(null)

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
      }
    })

    return () => {
      unsub()
      ws.close()
    }
  }, [auth.token])

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
  }

  return (
    <div className={styles.root}>
      <Sidebar
        channels={channels}
        activeChannelId={activeChannel?.id ?? null}
        onSelectChannel={setActiveChannel}
        onCreateChannel={handleCreateChannel}
        onRenameChannel={handleRenameChannel}
        onDeleteChannel={handleDeleteChannel}
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
