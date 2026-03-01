import { useEffect, useState } from 'react'
import Login from './pages/Login.tsx'
import Main from './pages/Main.tsx'
import ServerSetup from './pages/ServerSetup.tsx'
import { getServerUrl, clearServerUrl } from './lib/config.ts'
import BootOverlay from './components/BootOverlay.tsx'
import ContextMenu from './components/ContextMenu.tsx'
import bootSoundUrl from '../sounds/lovelyboot1.mp3?url'
import poweronSoundUrl from '../sounds/firsttimelaunch2q.mp3?url'

export interface AuthState {
  token: string
  userId: string
  username: string
  displayName: string
}

interface TextMenu {
  x: number
  y: number
  selectedText: string
  isEditable: boolean
}

export default function App() {
  const [serverConfigured, setServerConfigured] = useState(() => getServerUrl() !== null)
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [bootDone, setBootDone] = useState(false)
  const [bootClearing, setBootClearing] = useState(false)
  const [textMenu, setTextMenu] = useState<TextMenu | null>(null)

  useEffect(() => {
    if (serverConfigured) {
      new Audio(bootSoundUrl).play().catch(() => {})
    } else {
      new Audio(poweronSoundUrl).play().catch(() => {})
    }
  }, [])

  useEffect(() => {
    function handleContextMenu(e: MouseEvent) {
      e.preventDefault()
      const selectedText = window.getSelection()?.toString().trim() ?? ''
      const target = e.target as HTMLElement
      const isEditable =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      if (selectedText || isEditable) {
        setTextMenu({ x: e.clientX, y: e.clientY, selectedText, isEditable })
      }
    }
    document.addEventListener('contextmenu', handleContextMenu)
    return () => document.removeEventListener('contextmenu', handleContextMenu)
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

  function textMenuItems() {
    const items = []
    if (textMenu?.selectedText) {
      items.push({ label: 'copy', action: () => navigator.clipboard.writeText(textMenu.selectedText) })
    }
    if (textMenu?.isEditable) {
      items.push({ label: 'paste', action: async () => {
        const text = await navigator.clipboard.readText()
        const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
        if (el && 'setRangeText' in el) {
          el.setRangeText(text, el.selectionStart ?? 0, el.selectionEnd ?? 0, 'end')
          el.dispatchEvent(new Event('input', { bubbles: true }))
        }
      }})
      items.push({ label: 'select all', action: () => {
        const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
        el?.select()
      }})
    }
    return items
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
      {textMenu && textMenuItems().length > 0 && (
        <ContextMenu
          x={textMenu.x}
          y={textMenu.y}
          items={textMenuItems()}
          onClose={() => setTextMenu(null)}
        />
      )}
    </>
  )
}
