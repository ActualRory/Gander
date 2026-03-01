import { useEffect, useState } from 'react'
import Login from './pages/Login.tsx'
import Main from './pages/Main.tsx'
import ServerSetup from './pages/ServerSetup.tsx'
import { getServerUrl, clearServerUrl } from './lib/config.ts'
import BootOverlay from './components/BootOverlay.tsx'
import bootSoundUrl from '../sounds/lovelyboot1.mp3?url'
import poweronSoundUrl from '../sounds/firsttimelaunch2q.mp3?url'

export interface AuthState {
  token: string
  userId: string
  username: string
  displayName: string
}

export default function App() {
  const [serverConfigured, setServerConfigured] = useState(() => getServerUrl() !== null)
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [bootDone, setBootDone] = useState(false)
  const [bootClearing, setBootClearing] = useState(false)

  useEffect(() => {
    if (serverConfigured) {
      new Audio(bootSoundUrl).play().catch(() => {})
    } else {
      new Audio(poweronSoundUrl).play().catch(() => {})
    }
  }, [])

  function handleConfigured() {
    new Audio(bootSoundUrl).play().catch(() => {})
    setServerConfigured(true)
  }

  function handleChangeServer() {
    clearServerUrl()
    setAuth(null)
    setServerConfigured(false)
    setBootClearing(true)
  }

  function renderPage() {
    if (!serverConfigured) return <ServerSetup onConfigured={handleConfigured} bootClearing={bootClearing} />
    if (!auth) return <Login onAuth={setAuth} onChangeServer={handleChangeServer} />
    return <Main auth={auth} onLogout={() => setAuth(null)} />
  }

  return (
    <>
      {renderPage()}
      {!bootDone && (
        <BootOverlay
          onDone={() => setBootDone(true)}
          onClearing={() => setBootClearing(true)}
        />
      )}
    </>
  )
}
