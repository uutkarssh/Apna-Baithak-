'use client'

import { useState } from 'react'
import { ArrowLeft, Mail, Lock, User as UserIcon, Chrome, Phone } from 'lucide-react'
import { useApp } from '@/store/app'
import { useAuth } from '@/components/providers/auth-provider'
import { toast } from 'sonner'
import { BrandIcon, BrandWordmark } from '@/components/brand/brand-logo'

export function LoginView() {
  const back = useApp((s) => s.back)
  const returnFromLogin = useApp((s) => s.returnFromLogin)
  const { signInWithEmail, signUpWithEmail, signInWithGoogle } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      if (mode === 'signin') {
        const { error } = await signInWithEmail(email, password)
        if (error) throw new Error(error)
        toast.success('Signed in')
      } else {
        if (!name.trim()) throw new Error('Please enter your name')
        // Validate 10-digit Indian mobile number.
        // Accepts input with or without +91/0 prefix; we strip to last 10 digits.
        const digits = phone.replace(/\D/g, '').replace(/^(91|0)?/, '')
        if (!/^[6-9]\d{9}$/.test(digits)) {
          throw new Error('Please enter a valid 10-digit Indian mobile number')
        }
        const normalizedPhone = `+91 ${digits}`
        const { error } = await signUpWithEmail(email, password, name.trim(), normalizedPhone)
        if (error) throw new Error(error)
        toast.success('Account created — check your email if confirmation is required')
      }
      // Return the user to the screen they were on before being asked to log
      // in (Profile, item-detail after favorites tap, cart after checkout tap,
      // location after address tap). Falls back to cart if none was remembered.
      returnFromLogin()
    } catch (e: any) {
      toast.error(e.message || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  async function google() {
    setBusy(true)
    const { error } = await signInWithGoogle()
    if (error) {
      setBusy(false)
      toast.error(error)
    }
    // else: OAuth redirect happens
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="px-4 py-3">
        <button onClick={back} className="grid h-9 w-9 place-items-center rounded-full bg-muted">
          <ArrowLeft className="h-5 w-5" />
        </button>
      </header>

      <div className="flex flex-col gap-6 px-5 pt-4">
        {/* Brand logo — icon + wordmark */}
        <div className="flex flex-col items-center gap-3 pb-2">
          <BrandIcon size={72} priority />
          <BrandWordmark height={32} priority />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-foreground">
            {mode === 'signin' ? 'Welcome back!' : 'Create your account'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to place your order. Browse the menu freely without logging in.
          </p>
        </div>

        {/* Google OAuth */}
        <button
          onClick={google}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-white py-3 text-sm font-bold text-foreground shadow-sm disabled:opacity-50"
        >
          <Chrome className="h-5 w-5 text-brand" />
          Continue with Google
        </button>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          OR
          <span className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          {mode === 'signup' && (
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-foreground">Full Name</span>
              <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2.5 focus-within:ring-2 focus-within:ring-brand/40">
                <UserIcon className="h-4 w-4 text-muted-foreground" />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="flex-1 bg-transparent text-sm outline-none"
                  required
                />
              </div>
            </label>
          )}
          {mode === 'signup' && (
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-foreground">
                Contact Number <span className="text-red-500">*</span>
              </span>
              <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2.5 focus-within:ring-2 focus-within:ring-brand/40">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <input
                  type="tel"
                  name="phone"
                  autoComplete="tel-national"
                  inputMode="numeric"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="10-digit mobile number"
                  className="flex-1 bg-transparent text-sm outline-none"
                  maxLength={10}
                  required
                />
              </div>
              <span className="mt-1 block text-[10px] text-muted-foreground">
                Required for delivery — we&#39;ll call/SMS on this number.
              </span>
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-foreground">Email</span>
            <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2.5 focus-within:ring-2 focus-within:ring-brand/40">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="flex-1 bg-transparent text-sm outline-none"
                required
              />
            </div>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-foreground">Password</span>
            <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2.5 focus-within:ring-2 focus-within:ring-brand/40">
              <Lock className="h-4 w-4 text-muted-foreground" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                minLength={6}
                className="flex-1 bg-transparent text-sm outline-none"
                required
              />
            </div>
          </label>

          <button
            type="submit"
            disabled={busy}
            className="mt-1 w-full rounded-xl bg-brand py-3 text-sm font-bold text-brand-foreground shadow-md disabled:opacity-50"
          >
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
          <button
            onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
            className="font-bold text-brand"
          >
            {mode === 'signin' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
        <div className="h-4" />
      </div>
    </div>
  )
}
