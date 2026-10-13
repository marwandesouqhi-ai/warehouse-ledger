import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
  prompt(): Promise<void>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null

export function registerServiceWorker() {
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          console.log('PWA ServiceWorker registered successfully with scope:', registration.scope)
        })
        .catch((error) => {
          console.warn('PWA ServiceWorker registration failed:', error)
        })
    })
  }
}

export function usePwaInstall() {
  const [canInstall, setCanInstall] = useState(false)
  const [isInstalled, setIsInstalled] = useState(() => {
    if (typeof window === 'undefined') return false
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    )
  })

  useEffect(() => {
    // Check if running in standalone mode
    const checkStandalone = () => {
      const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true
      setIsInstalled(isStandalone)
      if (isStandalone) setCanInstall(false)
    }

    checkStandalone()

    // Listen for beforeinstallprompt
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      deferredPrompt = event as BeforeInstallPromptEvent
      setCanInstall(true)
    }

    // Listen for successful install
    const handleAppInstalled = () => {
      deferredPrompt = null
      setCanInstall(false)
      setIsInstalled(true)
      console.log('PWA: Application was installed successfully!')
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const promptInstall = async () => {
    if (!deferredPrompt) {
      // If deferredPrompt is not available (e.g. Chrome already showing native button or iOS),
      // we can inform the user how to install directly from browser menu.
      alert('لتثبيت التطبيق: اضغط على أيقونة التثبيت في شريط عنوان المتصفح أو اختر "تثبيت التطبيق" من قائمة المتصفح.')
      return false
    }

    try {
      await deferredPrompt.prompt()
      const choice = await deferredPrompt.userChoice
      if (choice.outcome === 'accepted') {
        setCanInstall(false)
        setIsInstalled(true)
        deferredPrompt = null
        return true
      }
    } catch (err) {
      console.error('Error during PWA installation prompt:', err)
    }

    return false
  }

  return { canInstall, isInstalled, promptInstall }
}
