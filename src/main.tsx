import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './App.tsx'
import DialogHost from './components/DialogHost'
import { installClientErrorReporter } from './lib/clientErrorReporter'
import { registerServiceWorker } from './lib/pwa'
import '@fontsource/ibm-plex-sans-arabic/400.css'
import '@fontsource/ibm-plex-sans-arabic/500.css'
import '@fontsource/ibm-plex-sans-arabic/600.css'
import '@fontsource/ibm-plex-sans-arabic/700.css'
import './index.css'

registerServiceWorker()
installClientErrorReporter()

// After a deploy, an open tab may still reference deleted hashed chunks. Reload once to pick up the new build.
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (sessionStorage.getItem('znu-chunk-reload') === '1') return
    sessionStorage.setItem('znu-chunk-reload', '1')
    event.preventDefault()
    window.location.reload()
  } catch {
    // ignore
  }
})
window.addEventListener('load', () => {
  window.setTimeout(() => { try { sessionStorage.removeItem('znu-chunk-reload') } catch { /* ignore */ } }, 10_000)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <DialogHost />
    </BrowserRouter>
  </StrictMode>,
)
