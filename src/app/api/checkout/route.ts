import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSupabaseForUser } from '@/lib/supabase-server'
import { FEES, ORDER_STATUSES } from '@/lib/constants'
import { orderNumberFromSeq } from '@/lib/format'
import { distanceFromRestaurant, isWithinDeliveryRadius } from '@/lib/geo'
import { notifyNewOrder } from '@/lib/telegram'

// POST /api/checkout — creates a new order from the current cart.
// Body: {
//   items: [{ itemId, quantity }],
//   addressId: string (must belong to caller),
//   paymentMode: 'COD' | 'UPI',
//   notes?: string,
// }
export async function POST(req: NextRequest) {
  const supabase = await getSupabaseForUser(req)
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Please sign in to place an order.' }, { status: 401 })
  }

  const customer = await db.customer.findUnique({ where: { supabaseUserId: user.id } })
  if (!customer) {
    return NextResponse.json({ error: 'Customer profile missing.' }, { status: 400 })
  }

  const body = await req.json()
  const { items, addressId, paymentMode = 'COD', notes } = body ?? {}

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'Your cart is empty.' }, { status: 400 })
  }
  if (!addressId) {
    return NextResponse.json({ error: 'Please choose a delivery address.' }, { status: 400 })
  }
  if (!ORDER_STATUSES.includes('NEW')) {
    return NextResponse.json({ error: 'Bad status.' }, { status: 400 })
  }

  const address = await db.address.findUnique({ where: { id: addressId } })
  if (!address || address.customerId !== customer.id) {
    return NextResponse.json({ error: 'Address not found.' }, { status: 404 })
  }

  // 5 km delivery-radius check (spec Section 3.7)
  const distKm =
    address.distanceKm ?? distanceFromRestaurant(address.latitude, address.longitude)
  if (!isWithinDeliveryRadius(address.latitude, address.longitude)) {
    return NextResponse.json(
      {
        error: `Sorry, we only deliver within ${process.env.DELIVERY_RADIUS_KM ?? 5} km of the restaurant. Your address is ${distKm.toFixed(2)} km away.`,
      },
      { status: 400 }
    )
  }

  // Fetch live menu items (re-validate price/availability server-side)
  const itemIds = items.map((i: any) => i.itemId)
  const menuItems = await db.menuItem.findMany({
    where: { id: { in: itemIds }, isAvailable: true },
    include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } },
  })
  const byId = new Map(menuItems.map((m) => [m.id, m]))

  let itemTotal = 0
  const orderItemsData = items.map((i: any) => {
    const m = byId.get(i.itemId)
    if (!m) return null
    const qty = Math.max(1, Math.min(50, Number(i.quantity) || 1))
    itemTotal += m.price * qty
    return {
      itemId: m.id,
      itemName: m.name,
      itemPrice: m.price,
      quantity: qty,
      imageUrl: m.images[0]?.url ?? null,
    }
  }).filter((x): x is NonNullable<typeof x> => x !== null)

  if (orderItemsData.length === 0) {
    return NextResponse.json({ error: 'No valid items in cart.' }, { status: 400 })
  }

  const handlingFee = FEES.handlingFee
  const deliveryFee = FEES.deliveryFee
  const gstAndCharges = Math.round((itemTotal + handlingFee + deliveryFee) * FEES.gstRate)
  const totalAmount = itemTotal + handlingFee + deliveryFee + gstAndCharges

  // human-friendly order number: AB-YYYY-000N based on this year's count
  const yearStart = new Date(new Date().getFullYear(), 0, 1)
  const yearCount = await db.order.count({
    where: { createdAt: { gte: yearStart } },
  })
  const orderNumber = orderNumberFromSeq(yearCount + 1)

  const addressLine = [
    address.houseFlat,
    address.streetArea,
    address.landmark,
    `${address.city} - ${address.pincode}`,
  ]
    .filter(Boolean)
    .join(', ')

  const order = await db.order.create({
    data: {
      orderNumber,
      customerId: customer.id,
      addressId: address.id,
      customerName: customer.name ?? customer.email.split('@')[0],
      customerPhone: customer.phone,
      addressLine,
      status: 'NEW',
      paymentMode,
      paymentStatus: paymentMode === 'UPI' ? 'PENDING' : 'PENDING',
      itemTotal,
      handlingFee,
      deliveryFee,
      gstAndCharges,
      totalAmount,
      distanceKm: Number(distKm.toFixed(2)),
      notes: notes || null,
      items: { create: orderItemsData },
      statusHistory: {
        create: { status: 'NEW', note: 'Order placed by customer' },
      },
    },
    include: { items: true },
  })

  // Fire Telegram new-order notification (non-blocking — don't fail the
  // checkout if Telegram is down)
  notifyNewOrder(order.id).catch((e) =>
    console.error('[checkout] telegram notify error:', e)
  )

  return NextResponse.json({ order })
}
