import { useState } from 'react'
import Login from './pages/Login.tsx'
import Main from './pages/Main.tsx'

export interface AuthState {
  token: string
  userId: string
  username: string
  displayName: string
}

export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(null)

  if (!auth) return <Login onAuth={setAuth} />
  return <Main auth={auth} onLogout={() => setAuth(null)} />
}
