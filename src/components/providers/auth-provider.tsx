'use client'

import { useEffect, useState, useCallback, createContext, useContext, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Session, User } from '@supabase/supabase-js'
import { getSupabaseBrowser } from '@/lib/supabase-client'

type CustomerProfile = {
  id: string
  email: string
  name: string | null
  phone: string | null
  avatarUrl?: string | null
}

type AuthCtx = {
  session: Session | null
  user: User | null
  profile: CustomerProfile | null
  loading: boolean           // true only during the FIRST initial session check
  profileLoading: boolean    // true while a /api/auth/me fetch is in flight
  isAuthed: boolean          // convenience: session != null
  signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>
  signUpWithEmail: (email: string, password: string, name: string, phone: string) => Promise<{ error: string | null }>
  signInWithGoogle: () => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  updateProfile: (data: { name?: string; phone?: string }) => Promise<{ error: string | null }>
}

const Ctx = createContext<AuthCtx | null>(null)

// Keys whose cached data depends on the authenticated user. Whenever auth
// state changes (login or logout), these caches MUST be invalidated so every
// consumer (cart-view, checkout-view, profile-view, orders-view, top-bar,
// location-view-inner) re-fetches with the new auth context — without
// requiring a page reload.
const AUTH_SCOPED_QUERY_KEYS = [
  ['addresses'],
  ['orders'],
  ['restaurant-rating'],
]

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = getSupabaseBrowser()
  const qc = useQueryClient()

  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<CustomerProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(false)

  // ===== Refs (stable across renders — no closure-stale bugs) =====
  const lastTokenRef = useRef<string | null>(null)
  const mountedRef = useRef(true)
  const inFlightRef = useRef(false)

  // ===== refreshProfile — stable identity, no `profile` dep =====
  // Uses refs instead of closure values so it never goes stale and never
  // triggers a re-subscribe of the onAuthStateChange effect.
  const refreshProfile = useCallback(async () => {
    if (!mountedRef.current) return
    // Prevent overlapping fetches (e.g. when signInWithEmail AND the
    // onAuthStateChange listener both call refreshProfile for the same
    // login event).
    if (inFlightRef.current) return
    inFlightRef.current = true

    try {
      const { data } = await supabase.auth.getSession()
      if (!mountedRef.current) return
      const s = data.session
      setSession(s)

      if (!s?.user) {
        setProfile(null)
        lastTokenRef.current = null
        return
      }

      // Skip duplicate fetches for the SAME token (e.g. onAuthStateChange
      // INITIAL_SESSION event after we already fetched in signInWithEmail).
      if (lastTokenRef.current === s.access_token) return
      lastTokenRef.current = s.access_token

      if (!mountedRef.current) return
      setProfileLoading(true)
      try {
        const res = await fetch('/api/auth/me', {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${s.access_token}` },
        })
        if (!mountedRef.current) return
        if (res.ok) {
          const json = await res.json()
          setProfile(json.profile ?? null)
        } else {
          setProfile(null)
        }
      } catch {
        if (mountedRef.current) setProfile(null)
      } finally {
        if (mountedRef.current) setProfileLoading(false)
      }
    } finally {
      inFlightRef.current = false
    }
  }, [supabase])

  // ===== Single, lifetime onAuthStateChange subscription =====
  // The effect depends only on [supabase, refreshProfile], and since both
  // are stable (supabase is a singleton, refreshProfile has no `profile`
  // dep), this effect runs exactly ONCE on mount and never re-subscribes.
  // This eliminates the prior bug where profile updates triggered re-subscribe
  // and could miss auth events during the brief unsubscribe/resubscribe gap.
  useEffect(() => {
    mountedRef.current = true

    let cancelled = false

    // Initial session check — fires once on mount.
    ;(async () => {
      try {
        const { data } = await supabase.auth.getSession()
        if (cancelled) return
        setSession(data.session)
        if (data.session) {
          // Force fetch — reset lastTokenRef so refreshProfile doesn't dedup-skip.
          lastTokenRef.current = null
          await refreshProfile()
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    // Subscribe to all subsequent auth state changes (SIGNED_IN, SIGNED_OUT,
    // TOKEN_REFRESHED, INITIAL_SESSION, USER_UPDATED, MFA_CHALLENGE_VERIFIED,
    // PASSWORD_RECOVERY). For ANY event with a session, we re-fetch the
    // profile — this is the single source of truth for "is the user logged in".
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (cancelled) return
      setSession(s)

      if (s) {
        // Force re-fetch — clear lastTokenRef so refreshProfile actually fetches
        // even if the access_token string is identical (e.g. USER_UPDATED event
        // with the same token but the customer record may have changed).
        lastTokenRef.current = null
        refreshProfile()
        // Broadcast the auth change to all React Query consumers so any
        // addresses/orders queries that previously returned `[]` (logged-out)
        // now refetch with the new auth context. This is the key fix: it
        // makes the logged-in state propagate to Profile, Favorites, Cart,
        // Address selection instantly with zero page reload.
        AUTH_SCOPED_QUERY_KEYS.forEach((key) => {
          qc.invalidateQueries({ queryKey: key })
        })
      } else {
        // Signed out — clear profile and invalidate caches so stale data
        // doesn't leak between sessions.
        setProfile(null)
        lastTokenRef.current = null
        AUTH_SCOPED_QUERY_KEYS.forEach((key) => {
          qc.removeQueries({ queryKey: key })
        })
      }
      setLoading(false)
    })

    return () => {
      cancelled = true
      mountedRef.current = false
      sub.subscription.unsubscribe()
    }
  }, [supabase, refreshProfile, qc])

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return { error: error.message }
      // The onAuthStateChange listener will fire and call refreshProfile.
      // But we also call it here directly to guarantee profile is set by
      // the time the calling LoginView continues (no race).
      lastTokenRef.current = null
      await refreshProfile()
      // Eagerly invalidate caches too — covers the case where the auth
      // event hasn't fired yet but we want the next render's useQuery to
      // refetch with the new auth context.
      AUTH_SCOPED_QUERY_KEYS.forEach((key) => {
        qc.invalidateQueries({ queryKey: key })
      })
      return { error: null }
    },
    [supabase, refreshProfile, qc]
  )

  const signUpWithEmail = useCallback(
    async (email: string, password: string, name: string, phone: string) => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name, phone } },
      })
      if (error) return { error: error.message }
      // If signUp returns a session immediately (no email confirmation
      // required), refresh profile + invalidate caches.
      if (data.session) {
        lastTokenRef.current = null
        await refreshProfile()
        AUTH_SCOPED_QUERY_KEYS.forEach((key) => {
          qc.invalidateQueries({ queryKey: key })
        })
      }
      return { error: null }
    },
    [supabase, refreshProfile, qc]
  )

  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/` : undefined,
      },
    })
    if (error) return { error: error.message }
    return { error: null }
  }, [supabase])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
    lastTokenRef.current = null
    // Clear ALL auth-scoped caches immediately so the UI reflects logout
    // without waiting for the next render cycle.
    AUTH_SCOPED_QUERY_KEYS.forEach((key) => {
      qc.removeQueries({ queryKey: key })
    })
  }, [supabase, qc])

  // updateProfile — PATCH /api/auth/me to update name and/or phone.
  // On success, updates the local profile state immediately (no need to wait
  // for a full refreshProfile round-trip). Returns { error: null } on success
  // or { error: message } on failure.
  const updateProfile = useCallback(
    async (data: { name?: string; phone?: string }): Promise<{ error: string | null }> => {
      try {
        const { data: sessData } = await supabase.auth.getSession()
        const token = sessData.session?.access_token
        const res = await fetch('/api/auth/me', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(data),
        })
        const json = await res.json()
        if (!res.ok) {
          return { error: json.error || 'Failed to update profile' }
        }
        // Update local profile state immediately
        if (json.profile) {
          setProfile(json.profile)
        }
        return { error: null }
      } catch (e: any) {
        return { error: e.message || 'Failed to update profile' }
      }
    },
    [supabase]
  )

  return (
    <Ctx.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        loading,
        profileLoading,
        isAuthed: !!session,
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        signOut,
        refreshProfile,
        updateProfile,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
