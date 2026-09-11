import 'server-only'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import fs from 'fs'
import path from 'path'
import fontkit from '@pdf-lib/fontkit'

// ====== A4 dimensions (points; 1pt = 1/72 inch) ======
const PAGE_W = 595.28
const PAGE_H = 841.89

// ====== Safe zones for the current letterhead ======
// The new letterhead has a taller decorative header and a large lower
// illustration. Keep all dynamic receipt text inside the clean white centre.
const HEADER_ZONE = PAGE_H * 0.28
const FOOTER_ZONE = PAGE_H * 0.25
const CONTENT_TOP = PAGE_H - HEADER_ZONE
const CONTENT_BOTTOM = FOOTER_ZONE
const CONTENT_HEIGHT = CONTENT_TOP - CONTENT_BOTTOM

// Keep the generated receipt comfortably inside the printable white area.
const MARGIN_X = 28
const CONTENT_WIDTH = PAGE_W - 2 * MARGIN_X

const BRAND_ORANGE = rgb(0xff / 0xff, 0x52 / 0xff, 0x52 / 0xff)
const DARK = rgb(0x1a / 0xff, 0x1a / 0xff, 0x1a / 0xff)
const MUTED = rgb(0x6b / 0xff, 0x6b / 0xff, 0x6b / 0xff)
const LIGHT_BG = rgb(0xf5 / 0xff, 0xf5 / 0xff, 0xf5 / 0xff)
const BORDER = rgb(0xe5 / 0xff, 0xe5 / 0xff, 0xe5 / 0xff)

export type ReceiptItem = {
  itemName: string
  quantity: number
  itemPrice: number
}

export type ReceiptOrder = {
  orderNumber: string
  createdAt: string
  paymentMode: string
  paymentStatus: string
  customerName: string
  customerPhone?: string | null
  addressLine: string
  distanceKm?: number | null
  notes?: string | null
  itemTotal: number
  handlingFee: number
  deliveryFee: number
  gstAndCharges: number
  totalAmount: number
  items: ReceiptItem[]
}

let cachedLetterheadBytes: Buffer | null = null
let lookupFailed = false

function loadLetterhead(): Buffer | null {
  if (lookupFailed) return null
  if (cachedLetterheadBytes) return cachedLetterheadBytes

  const candidates = [
    path.join(process.cwd(), 'public', 'letterhead', 'letterhead.png'),
    path.join(__dirname, '..', '..', '..', 'public', 'letterhead', 'letterhead.png'),
  ]

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        cachedLetterheadBytes = fs.readFileSync(p)
        return cachedLetterheadBytes
      }
    } catch {
      // try next
    }
  }
  lookupFailed = true
  return null
}

let cachedRegularFont: Buffer | null = null
let cachedBoldFont: Buffer | null = null
let fontLookupFailed = false

function loadFonts(): { regular: Buffer; bold: Buffer } | null {
  if (fontLookupFailed) return null
  if (cachedRegularFont && cachedBoldFont) {
    return { regular: cachedRegularFont, bold: cachedBoldFont }
  }

  const candidates = [
    {
      regular: path.join(process.cwd(), 'public', 'fonts', 'DejaVuSans.ttf'),
      bold: path.join(process.cwd(), 'public', 'fonts', 'DejaVuSans-Bold.ttf'),
    },
    {
      regular: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      bold: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    },
  ]

  for (const c of candidates) {
    try {
      if (fs.existsSync(c.regular) && fs.existsSync(c.bold)) {
        cachedRegularFont = fs.readFileSync(c.regular)
        cachedBoldFont = fs.readFileSync(c.bold)
        return { regular: cachedRegularFont, bold: cachedBoldFont }
      }
    } catch {
      // try next
    }
  }
  fontLookupFailed = true
  return null
}

function fmtDateTime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return iso
  }
}

function rupees(n: number) {
  return `\u20B9${n}`
}

export async function buildReceiptPdf(order: ReceiptOrder): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Receipt ${order.orderNumber}`)
  pdf.setAuthor('Apna Baithak')
  pdf.setSubject(`Order ${order.orderNumber}`)
  pdf.setCreator('Apna Baithak')
  pdf.setProducer('Apna Baithak')

  pdf.registerFontkit(fontkit)

  const fonts = loadFonts()
  const regular = fonts ? await pdf.embedFont(fonts.regular, { subset: true }) : await pdf.embedFont(StandardFonts.Helvetica)
  const bold = fonts ? await pdf.embedFont(fonts.bold, { subset: true }) : await pdf.embedFont(StandardFonts.HelveticaBold)

  const letterheadBytes = loadLetterhead()
  let letterheadImg: Awaited<ReturnType<typeof pdf.embedPng>> | null = null
  if (letterheadBytes) {
    try {
      letterheadImg = await pdf.embedPng(letterheadBytes)
    } catch {
      letterheadImg = null
    }
  }

  function newPageWithLetterhead() {
    const page = pdf.addPage([PAGE_W, PAGE_H])
    if (letterheadImg) {
      page.drawImage(letterheadImg, {
        x: 0,
        y: 0,
        width: PAGE_W,
        height: PAGE_H,
      })

      // The current letterhead contains a faint utensil/food illustration in
      // the lower-right of the otherwise blank centre. Put an opaque white
      // writing area over the clean middle so generated text never sits on
      // top of that artwork. Header and footer artwork remain untouched.
      page.drawRectangle({
        x: MARGIN_X,
        y: CONTENT_BOTTOM,
        width: CONTENT_WIDTH,
        height: CONTENT_HEIGHT,
        color: rgb(1, 1, 1),
      })
    } else {
      page.drawRectangle({ x: 0, y: PAGE_H - HEADER_ZONE, width: PAGE_W, height: HEADER_ZONE, color: rgb(1, 1, 1) })
      page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: FOOTER_ZONE, color: rgb(1, 1, 1) })
      page.drawText('Apna Baithak', { x: MARGIN_X, y: PAGE_H - 50, size: 24, font: bold, color: BRAND_ORANGE })
      page.drawText('Suriyawan Road, Bankat Khas, UP 221308', {
        x: MARGIN_X,
        y: 30,
        size: 9,
        font: regular,
        color: MUTED,
      })
    }
    return page
  }

  function drawWrappedText(
    page: any,
    text: string,
    x: number,
    y: number,
    opts: { font?: any; size?: number; color?: any; maxWidth?: number; lineHeight?: number } = {}
  ): number {
    const font = opts.font ?? regular
    const size = opts.size ?? 10
    const color = opts.color ?? DARK
    const maxWidth = opts.maxWidth ?? CONTENT_WIDTH
    const lineHeight = opts.lineHeight ?? size + 3

    const words = text.split(/\s+/)
    let line = ''
    const lines: string[] = []
    for (const w of words) {
      const test = line ? line + ' ' + w : w
      const width = font.widthOfTextAtSize(test, size)
      if (width > maxWidth && line) {
        lines.push(line)
        line = w
      } else {
        line = test
      }
    }
    if (line) lines.push(line)

    let curY = y
    for (const ln of lines) {
      page.drawText(ln, { x, y: curY, size, font, color })
      curY -= lineHeight
    }
    return curY
  }

  let page = newPageWithLetterhead()
  let cursorY = CONTENT_TOP - 8

  // --- 1. Order meta row ---
  page.drawText('Order', { x: MARGIN_X, y: cursorY, size: 9, font: regular, color: MUTED })
  page.drawText(order.orderNumber, { x: MARGIN_X, y: cursorY - 12, size: 13, font: bold, color: DARK })

  const dateVal = fmtDateTime(order.createdAt)
  const col2X = MARGIN_X + CONTENT_WIDTH * 0.42
  page.drawText('Date & Time', { x: col2X, y: cursorY, size: 9, font: regular, color: MUTED })
  page.drawText(dateVal, { x: col2X, y: cursorY - 12, size: 10, font: bold, color: DARK })

  const col3X = MARGIN_X + CONTENT_WIDTH * 0.78
  page.drawText('Payment', { x: col3X, y: cursorY, size: 9, font: regular, color: MUTED })
  page.drawText(order.paymentMode, { x: col3X, y: cursorY - 12, size: 10, font: bold, color: DARK })
  const payStatusW = bold.widthOfTextAtSize(order.paymentStatus, 9)
  page.drawText(order.paymentStatus, {
    x: MARGIN_X + CONTENT_WIDTH - payStatusW,
    y: cursorY - 26,
    size: 9,
    font: bold,
    color: order.paymentStatus === 'PAID'
      ? rgb(0x10 / 0xff, 0xa0 / 0xff, 0x40 / 0xff)
      : rgb(0xd9 / 0xff, 0x77 / 0xff, 0x06 / 0xff),
  })

  cursorY -= 50

  page.drawLine({
    start: { x: MARGIN_X, y: cursorY },
    end: { x: MARGIN_X + CONTENT_WIDTH, y: cursorY },
    thickness: 0.5,
    color: BORDER,
  })
  cursorY -= 18

  // --- 2. Customer & delivery block ---
  page.drawText('Customer', { x: MARGIN_X, y: cursorY, size: 9, font: regular, color: MUTED })
  page.drawText(order.customerName, {
    x: MARGIN_X,
    y: cursorY - 12,
    size: 11,
    font: bold,
    color: DARK,
  })
  if (order.customerPhone) {
    const phoneLabelW = regular.widthOfTextAtSize('Customer', 9)
    page.drawText('Phone: ' + order.customerPhone, {
      x: MARGIN_X + phoneLabelW + 60,
      y: cursorY,
      size: 9,
      font: regular,
      color: MUTED,
    })
  }
  cursorY -= 28

  page.drawText('Delivery Address', { x: MARGIN_X, y: cursorY, size: 9, font: regular, color: MUTED })
  cursorY -= 12
  cursorY = drawWrappedText(page, order.addressLine, MARGIN_X, cursorY, {
    font: regular,
    size: 10,
    color: DARK,
    maxWidth: CONTENT_WIDTH,
    lineHeight: 13,
  })

  if (order.distanceKm != null) {
    cursorY -= 2
    page.drawText(`Distance from restaurant: ${order.distanceKm.toFixed(2)} km`, {
      x: MARGIN_X,
      y: cursorY,
      size: 9,
      font: regular,
      color: MUTED,
    })
    cursorY -= 14
  }

  cursorY -= 12
  page.drawLine({
    start: { x: MARGIN_X, y: cursorY },
    end: { x: MARGIN_X + CONTENT_WIDTH, y: cursorY },
    thickness: 0.5,
    color: BORDER,
  })
  cursorY -= 24

  // --- 3. Itemized table ---
  const tableTop = cursorY
  const headerHeight = 22
  page.drawRectangle({
    x: MARGIN_X,
    y: tableTop - headerHeight,
    width: CONTENT_WIDTH,
    height: headerHeight,
    color: BRAND_ORANGE,
  })

  const colQtyX = MARGIN_X + CONTENT_WIDTH * 0.58
  const colUnitX = MARGIN_X + CONTENT_WIDTH * 0.72
  const colTotalX = MARGIN_X + CONTENT_WIDTH * 0.88
  const headerLabelY = tableTop - 15
  page.drawText('Item Name', { x: MARGIN_X + 6, y: headerLabelY, size: 9, font: bold, color: rgb(1, 1, 1) })
  page.drawText('Qty', { x: colQtyX, y: headerLabelY, size: 9, font: bold, color: rgb(1, 1, 1) })
  page.drawText('Unit Price', { x: colUnitX, y: headerLabelY, size: 9, font: bold, color: rgb(1, 1, 1) })
  page.drawText('Line Total', { x: colTotalX, y: headerLabelY, size: 9, font: bold, color: rgb(1, 1, 1) })

  cursorY = tableTop - headerHeight

  const rowMinHeight = 22
  for (let i = 0; i < order.items.length; i++) {
    const it = order.items[i]
    const lineTotal = it.itemPrice * it.quantity

    const itemColWidth = colQtyX - MARGIN_X - 12
    const words = it.itemName.split(/\s+/)
    let line = ''
    const nameLines: string[] = []
    for (const w of words) {
      const test = line ? line + ' ' + w : w
      if (regular.widthOfTextAtSize(test, 9) > itemColWidth && line) {
        nameLines.push(line)
        line = w
      } else {
        line = test
      }
    }
    if (line) nameLines.push(line)
    const rowHeight = Math.max(rowMinHeight, nameLines.length * 12 + 8)

    if (cursorY - rowHeight < CONTENT_BOTTOM + 12) {
      page = newPageWithLetterhead()
      cursorY = CONTENT_TOP - 8
      page.drawRectangle({
        x: MARGIN_X,
        y: cursorY - headerHeight,
        width: CONTENT_WIDTH,
        height: headerHeight,
        color: BRAND_ORANGE,
      })
      page.drawText('Item Name', { x: MARGIN_X + 6, y: cursorY - 15, size: 9, font: bold, color: rgb(1, 1, 1) })
      page.drawText('Qty', { x: colQtyX, y: cursorY - 15, size: 9, font: bold, color: rgb(1, 1, 1) })
      page.drawText('Unit Price', { x: colUnitX, y: cursorY - 15, size: 9, font: bold, color: rgb(1, 1, 1) })
      page.drawText('Line Total', { x: colTotalX, y: cursorY - 15, size: 9, font: bold, color: rgb(1, 1, 1) })
      cursorY = cursorY - headerHeight
    }

    if (i % 2 === 1) {
      page.drawRectangle({
        x: MARGIN_X,
        y: cursorY - rowHeight,
        width: CONTENT_WIDTH,
        height: rowHeight,
        color: LIGHT_BG,
      })
    }

    const nameStartY = cursorY - 12
    let ny = nameStartY
    for (const ln of nameLines) {
      page.drawText(ln, { x: MARGIN_X + 6, y: ny, size: 9, font: regular, color: DARK })
      ny -= 11
    }

    const qtyStr = String(it.quantity)
    const unitStr = rupees(it.itemPrice)
    const totalStr = rupees(lineTotal)
    page.drawText(qtyStr, { x: colQtyX, y: nameStartY, size: 9, font: regular, color: DARK })
    page.drawText(unitStr, { x: colUnitX, y: nameStartY, size: 9, font: regular, color: DARK })
    page.drawText(totalStr, { x: colTotalX, y: nameStartY, size: 9, font: bold, color: DARK })

    cursorY -= rowHeight
  }

  cursorY -= 16

  // --- 4. Bill summary block ---
  function drawRight(label: string, value: string, opts: { bold?: boolean; size?: number; color?: any } = {}) {
    const f = opts.bold ? bold : regular
    const size = opts.size ?? 9
    const color = opts.color ?? DARK
    const rightEdge = MARGIN_X + CONTENT_WIDTH - 4
    const vw = f.widthOfTextAtSize(value, size)
    const labelX = rightEdge - vw - 80
    page.drawText(label, { x: labelX, y: cursorY, size, font: f, color: opts.bold ? DARK : MUTED })
    page.drawText(value, { x: rightEdge - vw, y: cursorY, size, font: f, color })
    cursorY -= size + 6
  }

  drawRight('Item Total', rupees(order.itemTotal))
  drawRight('Handling Fee', rupees(order.handlingFee))
  drawRight('Delivery Fee', rupees(order.deliveryFee))
  drawRight('GST & Charges', rupees(order.gstAndCharges))

  cursorY -= 4

  // TOTAL row
  const totalHeight = 24
  if (cursorY - totalHeight < CONTENT_BOTTOM + 18) {
    page = newPageWithLetterhead()
    cursorY = CONTENT_TOP - 8
  }
  page.drawRectangle({
    x: MARGIN_X,
    y: cursorY - totalHeight,
    width: CONTENT_WIDTH,
    height: totalHeight,
    color: rgb(0xff / 0xff, 0xed / 0xff, 0xe5 / 0xff),
    borderColor: BRAND_ORANGE,
    borderWidth: 1,
  })
  const totalLabelW = bold.widthOfTextAtSize('TOTAL', 12)
  const totalValStr = rupees(order.totalAmount)
  const totalValW = bold.widthOfTextAtSize(totalValStr, 12)
  page.drawText('TOTAL', {
    x: MARGIN_X + CONTENT_WIDTH - totalValW - totalLabelW - 30,
    y: cursorY - 16,
    size: 12,
    font: bold,
    color: DARK,
  })
  page.drawText(totalValStr, {
    x: MARGIN_X + CONTENT_WIDTH - totalValW - 4,
    y: cursorY - 16,
    size: 12,
    font: bold,
    color: BRAND_ORANGE,
  })
  cursorY -= totalHeight + 12

  // --- 5. Notes ---
  if (order.notes) {
    if (cursorY - 30 < CONTENT_BOTTOM + 12) {
      page = newPageWithLetterhead()
      cursorY = CONTENT_TOP - 8
    }
    page.drawText('Customer Note', { x: MARGIN_X, y: cursorY, size: 9, font: bold, color: rgb(0xd9 / 0xff, 0x77 / 0xff, 0x06 / 0xff) })
    cursorY -= 12
    cursorY = drawWrappedText(page, order.notes, MARGIN_X, cursorY, {
      font: regular,
      size: 9,
      color: MUTED,
      maxWidth: CONTENT_WIDTH,
      lineHeight: 12,
    })
  }

  return pdf.save()
}
