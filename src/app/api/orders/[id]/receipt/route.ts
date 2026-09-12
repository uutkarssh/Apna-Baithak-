import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isAdminAuthorized } from '@/lib/admin-guard'
import { buildReceiptPdf, type ReceiptOrder } from '@/lib/receipt-pdf'

// GET /api/orders/[id]/receipt
// Customer-facing receipt downloads do not require authentication.
// Admin-facing requests use ?admin=1 with admin authorization.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  const isAdmin = req.nextUrl.searchParams.get('admin') === '1'

  if (isAdmin && !isAdminAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const order = await db.order.findUnique({
    where: { id },
    include: { items: true },
  })

  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  const receiptOrder: ReceiptOrder = {
    orderNumber: order.orderNumber,
    createdAt: order.createdAt.toISOString(),
    paymentMode: order.paymentMode,
    paymentStatus: order.paymentStatus,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    addressLine: order.addressLine,
    distanceKm: order.distanceKm,
    notes: order.notes,
    itemTotal: order.itemTotal,
    handlingFee: order.handlingFee,
    deliveryFee: order.deliveryFee,
    gstAndCharges: order.gstAndCharges,
    totalAmount: order.totalAmount,
    items: order.items.map((oi) => ({
      itemName: oi.itemName,
      quantity: oi.quantity,
      itemPrice: oi.itemPrice,
    })),
  }

  const pdfBytes = await buildReceiptPdf(receiptOrder)

  return new NextResponse(pdfBytes as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="receipt-${order.orderNumber}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
