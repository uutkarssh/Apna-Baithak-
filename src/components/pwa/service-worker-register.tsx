'use client'

import { useEffect } from 'react'

/**
 * Registers the service worker (/public/sw.js) on the client after the
 * page has loaded. Only runs in production (skipped in dev to avoid
 * caching stale assets during development).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return

    const register = () => {
      navigator.serviceWorker
        .register('/sw.js')
        .catch(() => {
          // Silently fail — the app still works without a service worker,
          // it just won't be installable / offline-capable.
        })
    }

    // Register after window load to avoid competing with first paint.
    if (document.readyState === 'complete') {
      register()
    } else {
      window.addEventListener('load', register, { once: true })
      return () => window.removeEventListener('load', register)
    }
  }, [])

  return null
}
