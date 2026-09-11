import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSupabaseForUser } from '@/lib/supabase-server'
import { getSupabaseServer } from '@/lib/supabase-server'

// GET /api/auth/me — returns the customer profile mirror row for the current
// Supabase session (read from the Authorization header sent by the client).
// Creates the row on first login (mirrors auth user).
export async function GET(req: Request) {
  const supabase = await getSupabaseForUser(req)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ profile: null, session: null })
  }

  // Upsert the customer mirror row (idempotent)
  // First try by supabaseUserId, then by email (in case the row was created
  // with a different supabaseUserId — e.g. test users created via admin API)
  let customer = await db.customer.findUnique({
    where: { supabaseUserId: user.id },
  })
  if (!customer && user.email) {
    const existingByEmail = await db.customer.findUnique({
      where: { email: user.email },
    })
    if (existingByEmail) {
      // Link the existing row to this Supabase user
      customer = await db.customer.update({
        where: { id: existingByEmail.id },
        data: { supabaseUserId: user.id },
      })
    }
  }
  if (!customer) {
    const email = user.email ?? ''
    const name =
      (user.user_metadata?.full_name as string) ||
      (user.user_metadata?.name as string) ||
      (email ? email.split('@')[0] : 'Guest')
    const phone = (user.user_metadata?.phone as string) ?? null
    const avatarUrl = (user.user_metadata?.avatar_url as string) ?? null
    customer = await db.customer.create({
      data: {
        supabaseUserId: user.id,
        email,
        name,
        phone,
        avatarUrl,
      },
    })
  } else {
    // keep the mirror in sync with Supabase on each load
    const name =
      (user.user_metadata?.full_name as string) ||
      (user.user_metadata?.name as string) ||
      customer.name
    const phone = (user.user_metadata?.phone as string) ?? customer.phone
    const avatarUrl = (user.user_metadata?.avatar_url as string) ?? customer.avatarUrl
    if (
      name !== customer.name ||
      phone !== customer.phone ||
      avatarUrl !== customer.avatarUrl
    ) {
      customer = await db.customer.update({
        where: { id: customer.id },
        data: { name, phone, avatarUrl },
      })
    }
  }

  return NextResponse.json({
    profile: {
      id: customer.id,
      email: customer.email,
      name: customer.name,
      phone: customer.phone,
      avatarUrl: customer.avatarUrl,
    },
  })
}

// PATCH /api/auth/me — updates the customer's name and/or phone number.
// Body: { name?: string, phone?: string }
//
// Updates BOTH:
//  1. Supabase Auth user_metadata (full_name, phone) — via supabase.auth.updateUser
//  2. The Turso Customer mirror row — directly, for immediacy
//
// Phone validation: 10-digit Indian mobile (strips +91/0 prefix, must match
// ^[6-9]\d{9}$). Normalized to "+91 XXXXXXXXXX" format before storing.
// Name validation: non-empty after trim, max 100 chars.
//
// Returns the updated profile (same shape as GET).
export async function PATCH(req: Request) {
  const supabase = await getSupabaseForUser(req)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Please sign in.' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const { name, phone } = body as { name?: string; phone?: string }

  // Build the update payload — only include fields that were sent
  const updates: { name?: string; phone?: string } = {}

  if (name !== undefined) {
    const trimmed = String(name).trim()
    if (!trimmed) {
      return NextResponse.json({ error: 'Name cannot be empty.' }, { status: 400 })
    }
    if (trimmed.length > 100) {
      return NextResponse.json({ error: 'Name is too long (max 100 characters).' }, { status: 400 })
    }
    updates.name = trimmed
  }

  if (phone !== undefined) {
    // Validate 10-digit Indian mobile number.
    // Accepts input with or without +91/0 prefix; we strip to last 10 digits.
    const digits = String(phone).replace(/\D/g, '').replace(/^(91|0)?/, '')
    if (!/^[6-9]\d{9}$/.test(digits)) {
      return NextResponse.json(
        { error: 'Please enter a valid 10-digit Indian mobile number.' },
        { status: 400 }
      )
    }
    updates.phone = `+91 ${digits}`
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update.' }, { status: 400 })
  }

  // 1. Update Supabase Auth user_metadata so the change persists in the auth
  //    system and syncs back to Turso on future GET /api/auth/me calls.
  //    We use the service-role client + admin.updateUserById because the
  //    user's bearer token alone doesn't give a full session for
  //    auth.updateUser() in a server route.
  const supabaseAdmin = getSupabaseServer()
  const { error: supaErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...(updates.name != null ? { full_name: updates.name } : {}),
      ...(updates.phone != null ? { phone: updates.phone } : {}),
    },
  })
  if (supaErr) {
    return NextResponse.json(
      { error: `Failed to update profile: ${supaErr.message}` },
      { status: 500 }
    )
  }

  // 2. Update the Turso Customer mirror row directly (immediate, no need to
  //    wait for the next GET sync).
  let customer = await db.customer.findUnique({ where: { supabaseUserId: user.id } })
  if (!customer && user.email) {
    customer = await db.customer.findUnique({ where: { email: user.email } })
  }
  if (!customer) {
    return NextResponse.json({ error: 'Customer profile not found.' }, { status: 404 })
  }

  customer = await db.customer.update({
    where: { id: customer.id },
    data: updates,
  })

  return NextResponse.json({
    profile: {
      id: customer.id,
      email: customer.email,
      name: customer.name,
      phone: customer.phone,
      avatarUrl: customer.avatarUrl,
    },
  })
}
