import { useEffect, useState } from 'react'
import Login from './pages/Login.tsx'
import Main from './pages/Main.tsx'
import ServerSetup from './pages/ServerSetup.tsx'
import { getServerUrl, clearServerUrl } from './lib/config.ts'
import bootSoundUrl from '../sounds/lovelyboot1.mp3?url'

export interface AuthState {
  token: string
  userId: string
  username: string
  displayName: string
}

export default function App() {
  const [serverConfigured, setServerConfigured] = useState(() => getServerUrl() !== null)
  const [auth, setAuth] = useState<AuthState | null>(null)

  useEffect(() => {
    new Audio(bootSoundUrl).play().catch(() => {})
  }, [])

  function handleChangeServer() {
    clearServerUrl()
    setAuth(null)
    setServerConfigured(false)
  }

  if (!serverConfigured) return <ServerSetup onConfigured={() => setServerConfigured(true)} />
  if (!auth) return <Login onAuth={setAuth} />
  return <Main auth={auth} onLogout={() => setAuth(null)} onChangeServer={handleChangeServer} />
}
