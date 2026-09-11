'use client'

import { useSyncExternalStore, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useApp } from '@/store/app'
import { useCart } from '@/store/cart'
import { TopBar } from './top-bar'
import { TopNav, BottomNav } from './bottom-nav'
import { StickyCartBar } from './sticky-cart-bar'
import { HomeView } from './views/home-view'
import { CategoriesView } from './views/categories-view'
import { CategoryListingView } from './views/category-listing-view'
import { ItemDetailView } from './views/item-detail-view'
import { CartView } from './views/cart-view'
import LocationView from './views/location-view'
import { ProfileView } from './views/profile-view'
import { OrdersView } from './views/orders-view'
import { CheckoutView } from './views/checkout-view'
import { UpiPaymentView } from './views/upi-payment-view'
import { OrderConfirmationView } from './views/order-confirmation-view'
import { LoginView } from './views/login-view'

// Returns true only after client hydration completes.
const emptySubscribe = () => () => {}
function useMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  )
}

const VIEW_VARIANTS = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
}

const CART_BAR_VIEWS = new Set([
  'home',
  'categories',
  'category-listing',
  'item-detail',
])

const HIDE_TOPBAR_VIEWS = new Set([
  'item-detail',
  'cart',
  'category-listing',
  'categories',
  'location',
  'checkout',
  'orders',
  'profile',
  'login',
  'upi-payment',
  'order-confirmation',
])

export function ApnaBaithakApp() {
  const view = useApp((s) => s.view)
  const activeOrder = useApp((s) => s.activeOrder)
  const openItem = useApp((s) => s.openItem)
  const count = useCart((s) => s.count())
  const mounted = useMounted()

  const hideTopBar = HIDE_TOPBAR_VIEWS.has(view)
  const showCartBar = mounted && count > 0 && CART_BAR_VIEWS.has(view)

  // Always start a newly opened view at the top. This is especially important
  // for Cart: tapping the floating "View Cart" bar should show the full cart
  // header/address/items immediately, rather than preserving the Home scroll
  // position and opening the Cart halfway down the page.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
      const main = document.querySelector('main')
      if (main instanceof HTMLElement) main.scrollTop = 0
    })
    return () => window.cancelAnimationFrame(frame)
  }, [view])

  // Handle shared-item deep links: /?item=<slug> opens the item detail view.
  // Runs once on mount (client-side only). The slug is validated by the item
  // detail view's own fetch — if it doesn't exist, the user sees a "not found"
  // state and can navigate back.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const itemSlug = params.get('item')
    if (itemSlug) {
      openItem(itemSlug)
      // Clean the URL so the item doesn't re-open on every refresh
      const url = new URL(window.location.href)
      url.searchParams.delete('item')
      window.history.replaceState({}, '', url.toString())
    }
  }, [openItem])

  return (
    // Responsive shell — nav-bar POSITION follows ORIENTATION, content-grid
    // column counts follow WIDTH. The two are decoupled so that:
    //   - Portrait (any width, including tablet portrait) → bottom tab bar
    //   - Landscape (any width, including phone landscape) → top nav bar
    //
    // DOM ordering:
    //   1. TopNav (landscape only) — placed BEFORE <main> so it sits at top
    //   2. <main> with the active view
    //   3. BottomNav (portrait only) — placed AFTER <main> so its
    //      `sticky bottom-0` correctly pins to the viewport bottom
    //   4. StickyCartBar (portrait only, when cart has items) — overlays
    //      above the bottom nav
    <div className="flex min-h-[100dvh] flex-col bg-muted/30" suppressHydrationWarning>
      <TopNav />

      <main
        // Responsive shell: content max-width and side padding scale by
        // viewport WIDTH (content grids reflow on wider screens). The
        // bottom padding, however, is ORIENTATION-based — we need ~96px
        // of clear space at the bottom in portrait (for the sticky bottom
        // nav bar to sit on top of without covering content), but only
        // ~24px in landscape (no bottom nav, just normal page padding).
        className="mx-auto w-full max-w-screen-2xl flex-1 bg-background px-0 pb-24 sm:px-6 landscape:pb-6 lg:px-8"
        suppressHydrationWarning
      >
        {!hideTopBar && <TopBar />}
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={VIEW_VARIANTS.initial}
            animate={VIEW_VARIANTS.animate}
            exit={VIEW_VARIANTS.exit}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            {view === 'home' && <HomeView />}
            {view === 'categories' && <CategoriesView />}
            {view === 'category-listing' && <CategoryListingView />}
            {view === 'item-detail' && <ItemDetailView />}
            {view === 'cart' && <CartView />}
            {view === 'location' && <LocationView />}
            {view === 'profile' && <ProfileView />}
            {view === 'orders' && <OrdersView />}
            {view === 'checkout' && <CheckoutView />}
            {view === 'login' && <LoginView />}
            {view === 'upi-payment' && activeOrder && <UpiPaymentView order={activeOrder} />}
            {view === 'order-confirmation' && activeOrder && (
              <OrderConfirmationView order={activeOrder} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {showCartBar && <StickyCartBar />}
      <BottomNav />
      {/* Tiny extra spacer when cart has items, only in portrait (the
          landscape top-nav doesn't need this since there's no bottom bar
          for the floating cart bar to sit above). */}
      {count > 0 && mounted && <div className="h-4 landscape:hidden" />}
    </div>
  )
}
