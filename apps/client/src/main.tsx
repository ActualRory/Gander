import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import ToastPage from './pages/Toast.tsx'
import './styles/global.css'

const isToast = new URLSearchParams(window.location.search).get('page') === 'toast'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isToast ? <ToastPage /> : <App />}
  </React.StrictMode>
)
