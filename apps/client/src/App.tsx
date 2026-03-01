import { useEffect, useState } from 'react'
import Login from './pages/Login.tsx'
import Main from './pages/Main.tsx'
import bootSoundUrl from '../sounds/lovelyboot1.mp3?url'

export interface AuthState {
  token: string
  userId: string
  username: string
  displayName: string
}

export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(null)

  useEffect(() => {
    new Audio(bootSoundUrl).play().catch(() => {})
  }, [])

  if (!auth) return <Login onAuth={setAuth} />
  return <Main auth={auth} onLogout={() => setAuth(null)} />
}
