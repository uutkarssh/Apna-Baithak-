'use client'

import { useEffect } from 'react'

function updateMobileClass() {
  if (typeof window === 'undefined') return

  // Chrome's "Desktop site" can expose a desktop-sized CSS viewport even
  // though the browser is still running on a phone. Use the physical screen
  // size + touch capability so the app can keep its phone layout in that case.
  const smallestScreenSide = Math.min(window.screen.width, window.screen.height)
  const isTouchDevice = navigator.maxTouchPoints > 0
  const isPhoneOrTablet = smallestScreenSide <= 900

  document.documentElement.classList.toggle(
    'apna-mobile-device',
    isTouchDevice && isPhoneOrTablet,
  )
}

export function MobileLayoutGuard() {
  useEffect(() => {
    updateMobileClass()
    window.addEventListener('resize', updateMobileClass)
    window.addEventListener('orientationchange', updateMobileClass)

    return () => {
      window.removeEventListener('resize', updateMobileClass)
      window.removeEventListener('orientationchange', updateMobileClass)
    }
  }, [])

  return null
}
