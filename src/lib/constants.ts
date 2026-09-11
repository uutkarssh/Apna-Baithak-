// Restaurant fixed details + app-wide constants (from spec Section 0)

export const RESTAURANT = {
  name: 'Apna Baithak',
  address:
    'Suriyawan Road, near Union Bank, Subhash Nagar, Sudhavai, Bankat Khas, Uttar Pradesh 221308',
  phone: '+91 7307594163',
  email: 'apnabaithak73@gmail.com',
  lat: Number(process.env.RESTAURANT_LAT ?? 25.337698),
  lng: Number(process.env.RESTAURANT_LNG ?? 82.351485),
  deliveryRadiusKm: Number(process.env.DELIVERY_RADIUS_KM ?? 5),
  // simple ETA estimate shown in the top bar
  deliveryEtaMin: '25-35 min',
}

// Hardcoded admin login (Section 3.9) — NOT a DB or Supabase account.
export const ADMIN_CREDENTIALS = {
  email: process.env.ADMIN_EMAIL ?? 'utkarshmaurya88409@gmail.com',
  password: process.env.ADMIN_PASSWORD ?? 'Apna-Baithak-2026',
}

// Bill breakdown constants — flat fees, no free-delivery-unlock (spec Section 3.6)
export const FEES = {
  handlingFee: 5,      // ₹
  deliveryFee: 20,     // ₹ flat
  gstRate: 0.05,       // 5% on (itemTotal + handling + delivery)
}

export const PAYMENT_MODES = [
  { id: 'COD', label: 'Cash on Delivery', desc: 'Pay with cash at your door' },
  { id: 'UPI', label: 'UPI', desc: 'Pay via any UPI app on delivery' },
] as const

export const ORDER_STATUSES = [
  'NEW',
  'PREPARING',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  NEW: 'New',
  PREPARING: 'Preparing',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
}

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  NEW: 'bg-blue-100 text-blue-700',
  PREPARING: 'bg-amber-100 text-amber-700',
  OUT_FOR_DELIVERY: 'bg-purple-100 text-purple-700',
  DELIVERED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-red-100 text-red-700',
}

// Max images per menu item (spec Section 3.9)
export const MAX_ITEM_IMAGES = 5
