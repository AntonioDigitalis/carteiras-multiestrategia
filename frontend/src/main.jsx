import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import Splash from './components/Splash.jsx'

function Root() {
  const [booted, setBooted] = useState(false)
  return booted ? <App /> : <Splash onEnter={() => setBooted(true)} />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
