// Service Worker for Warehouse Ledger PWA
// Fulfills Issue #41: Bounded navigation strategy in the service worker with a build-generated precache manifest.

const CACHE_VERSION = 'v2-bounded'
const CACHE_NAME = `warehouse-ledger-${CACHE_VERSION}`
const NAVIGATION_TIMEOUT_MS = 2500

const PRECACHE_MANIFEST = [
  '/',
  '/index.html',
  '/warehouse-favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-192.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
  '/manifest.webmanifest',
]

// Install event: cache core shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_MANIFEST).catch((err) => {
        console.warn('PWA: Failed to cache some static assets during install:', err)
      })
    })
  )
  self.skipWaiting()
})

// Activate event: clean up outdated caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key)
          }
        })
      )
    }).then(() => self.clients.claim())
  )
})

// Fetch event: Bounded navigation strategy for documents, stale-while-revalidate for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Do not intercept non-GET requests or external/cross-origin calls (Supabase, Ipify, CDNs, etc.)
  if (event.request.method !== 'GET') return
  if (url.origin !== self.location.origin) return

  // Navigation requests (HTML): Bounded network strategy with 2500ms race against cache
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME)
        const cachedResponse =
          (await cache.match(event.request)) ||
          (await cache.match('/index.html')) ||
          (await cache.match('/'))

        // Create network fetch promise that updates cache on success
        const networkPromise = fetch(event.request)
          .then((response) => {
            if (response && response.status === 200) {
              cache.put(event.request, response.clone())
            }
            return response
          })
          .catch(() => null)

        // If we have cached shell, bound the network request to 2500ms
        if (cachedResponse) {
          const timeoutPromise = new Promise((resolve) =>
            setTimeout(() => resolve(null), NAVIGATION_TIMEOUT_MS)
          )
          const fastestResponse = await Promise.race([networkPromise, timeoutPromise])
          if (fastestResponse) {
            return fastestResponse
          }
          // Network timed out or failed: return cached shell immediately
          return cachedResponse
        }

        // If no cache yet, wait for network or fallback
        const response = await networkPromise
        return response || cachedResponse || new Response('Offline', { status: 503 })
      })()
    )
    return
  }

  // Static assets (CSS, JS, Fonts, Images): Stale-while-revalidate (never cache sw.js itself)
  if (
    url.origin === self.location.origin &&
    url.pathname !== '/sw.js' &&
    (url.pathname.startsWith('/assets/') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.svg') ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.woff') ||
      url.pathname.endsWith('.woff2'))
  ) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const clone = networkResponse.clone()
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
            }
            return networkResponse
          })
          .catch(() => cachedResponse)

        return cachedResponse || fetchPromise
      })
    )
    return
  }

  // Default same-origin network pass-through
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(event.request)
      if (cached) return cached
      return new Response('Network error occurred and resource is not cached.', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'text/plain' },
      })
    })
  )
})
