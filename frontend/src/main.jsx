import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import Splash from './components/Splash.jsx'

const SPLASH_KEY = 'mara_splash_visto'

function Root() {
  const [booted, setBooted] = useState(() => {
    try {
      return localStorage.getItem(SPLASH_KEY) === '1'
    } catch {
      return false
    }
  })

  function entrar() {
    try { localStorage.setItem(SPLASH_KEY, '1') } catch {}
    setBooted(true)
  }

  return booted ? <App /> : <Splash onEnter={entrar} />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
