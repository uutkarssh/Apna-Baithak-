import 'server-only'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import fs from 'fs'
import path from 'path'
import fontkit from '@pdf-lib/fontkit'

// ====== A4 dimensions (points; 1pt = 1/72 inch) ======
const PAGE_W = 595.28
const PAGE_H = 841.89

// ====== Safe zones for the current letterhead ======
const HEADER_ZONE = PAGE_H * 0.24
const FOOTER_ZONE = PAGE_H * 0.20
const CONTENT_TOP = PAGE_H - HEADER_ZONE
const CONTENT_BOTTOM = FOOTER_ZONE
const CONTENT_HEIGHT = CONTENT_TOP - CONTENT_BOTTOM

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

function findNextFont(family: 'poppins' | 'outfit', weight: '400' | '700'): Buffer | null {
  const roots = [
    path.join(process.cwd(), 'public', 'fonts'),
    path.join(process.cwd(), '.next', 'static', 'media'),
  ]

  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) continue
      const queue = [root]
      while (queue.length) {
        const dir = queue.pop()!
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            queue.push(full)
            continue
          }
          const name = entry.name.toLowerCase()
          if (
            name.includes(family) &&
            (name.includes(`-${weight}-`) || name.includes(`_${weight}_`) || name.includes(weight)) &&
            /\.(ttf|otf|woff2?)$/i.test(name)
          ) {
            return fs.readFileSync(full)
          }
        }
      }
    } catch {
      // try next root
    }
  }
  return null
}

/**
 * Load the brand fonts from public/fonts so the receipt generator works
 * reliably in Vercel/serverless builds. Outfit is used for regular text and
 * Poppins for bold headings/prices. DejaVu remains a safe fallback.
 */
function loadFonts(): { regular: Buffer; bold: Buffer } | null {
  if (fontLookupFailed) return null
  if (cachedRegularFont && cachedBoldFont) {
    return { regular: cachedRegularFont, bold: cachedBoldFont }
  }

  try {
    const outfit = findNextFont('outfit', '400')
    const poppins = findNextFont('poppins', '700')
    if (outfit && poppins) {
      cachedRegularFont = outfit
      cachedBoldFont = poppins
      return { regular: outfit, bold: poppins }
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
      if (fs.existsSync(c.regular) && fs.existsSync(c.bold)) {
        cachedRegularFont = fs.readFileSync(c.regular)
        cachedBoldFont = fs.readFileSync(c.bold)
        return { regular: cachedRegularFont, bold: cachedBoldFont }
      }
    }
  } catch {
    // fall back to standard PDF fonts
  }

  fontLookupFailed = true
  return null
}

function fmtDateTime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
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
    try { letterheadImg = await pdf.embedPng(letterheadBytes) } catch { letterheadImg = null }
  }

  function newPageWithLetterhead() {
    const page = pdf.addPage([PAGE_W, PAGE_H])
    if (letterheadImg) {
      page.drawImage(letterheadImg, { x: 0, y: 0, width: PAGE_W, height: PAGE_H })
    }
    return page
  }

  let page = newPageWithLetterhead()
  let cursorY = CONTENT_TOP - 8

  // --- Customer/order header ---
  page.drawText(`Order ${order.orderNumber}`, { x: MARGIN_X, y: cursorY, size: 12, font: bold, color: DARK })
  cursorY -= 16
  page.drawText(order.customerName, { x: MARGIN_X, y: cursorY, size: 9, font: bold, color: DARK })
  cursorY -= 12
  page.drawText(`Date: ${fmtDateTime(order.createdAt)}`, { x: MARGIN_X, y: cursorY, size: 8, font: regular, color: MUTED })
  cursorY -= 11
  page.drawText(`Payment: ${order.paymentMode} (${order.paymentStatus})`, { x: MARGIN_X, y: cursorY, size: 8, font: regular, color: MUTED })
  cursorY -= 11
  page.drawText(`Address: ${order.addressLine}`, { x: MARGIN_X, y: cursorY, size: 8, font: regular, color: MUTED, maxWidth: CONTENT_WIDTH })
  cursorY -= 20

  const headerHeight = 24
  const tableTop = cursorY
  page.drawRectangle({ x: MARGIN_X, y: tableTop - headerHeight, width: CONTENT_WIDTH, height: headerHeight, color: BRAND_ORANGE })

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
      if (regular.widthOfTextAtSize(test, 9) > itemColWidth && line) { nameLines.push(line); line = w } else line = test
    }
    if (line) nameLines.push(line)
    const rowHeight = Math.max(rowMinHeight, nameLines.length * 12 + 8)

    if (cursorY - rowHeight < CONTENT_BOTTOM + 12) {
      page = newPageWithLetterhead()
      cursorY = CONTENT_TOP - 8
    }

    if (i % 2 === 1) page.drawRectangle({ x: MARGIN_X, y: cursorY - rowHeight, width: CONTENT_WIDTH, height: rowHeight, color: LIGHT_BG })
    const nameStartY = cursorY - 12
    let ny = nameStartY
    for (const ln of nameLines) { page.drawText(ln, { x: MARGIN_X + 6, y: ny, size: 9, font: regular, color: DARK }); ny -= 11 }
    page.drawText(String(it.quantity), { x: colQtyX, y: nameStartY, size: 9, font: regular, color: DARK })
    page.drawText(rupees(it.itemPrice), { x: colUnitX, y: nameStartY, size: 9, font: regular, color: DARK })
    page.drawText(rupees(lineTotal), { x: colTotalX, y: nameStartY, size: 9, font: bold, color: DARK })
    cursorY -= rowHeight
  }

  cursorY -= 16
  function drawRight(label: string, value: string, opts: { bold?: boolean; size?: number } = {}) {
    const f = opts.bold ? bold : regular
    const size = opts.size ?? 9
    const rightEdge = MARGIN_X + CONTENT_WIDTH - 4
    const vw = f.widthOfTextAtSize(value, size)
    page.drawText(label, { x: rightEdge - vw - 80, y: cursorY, size, font: f, color: opts.bold ? DARK : MUTED })
    page.drawText(value, { x: rightEdge - vw, y: cursorY, size, font: f, color: opts.bold ? BRAND_ORANGE : DARK })
    cursorY -= size + 6
  }
  drawRight('Item Total', rupees(order.itemTotal))
  drawRight('Handling Fee', rupees(order.handlingFee))
  drawRight('Delivery Fee', rupees(order.deliveryFee))
  drawRight('GST & Charges', rupees(order.gstAndCharges))

  cursorY -= 4
  const totalHeight = 24
  if (cursorY - totalHeight < CONTENT_BOTTOM + 18) { page = newPageWithLetterhead(); cursorY = CONTENT_TOP - 8 }
  page.drawRectangle({ x: MARGIN_X, y: cursorY - totalHeight, width: CONTENT_WIDTH, height: totalHeight, color: rgb(0xff / 0xff, 0xed / 0xff, 0xe5 / 0xff), borderColor: BRAND_ORANGE, borderWidth: 1 })
  const totalValStr = rupees(order.totalAmount)
  const totalValW = bold.widthOfTextAtSize(totalValStr, 12)
  page.drawText('TOTAL', { x: MARGIN_X + CONTENT_WIDTH - totalValW - 55, y: cursorY - 16, size: 12, font: bold, color: DARK })
  page.drawText(totalValStr, { x: MARGIN_X + CONTENT_WIDTH - totalValW - 4, y: cursorY - 16, size: 12, font: bold, color: BRAND_ORANGE })
  cursorY -= totalHeight + 12

  if (order.notes) {
    if (cursorY - 30 < CONTENT_BOTTOM + 12) { page = newPageWithLetterhead(); cursorY = CONTENT_TOP - 8 }
    page.drawText('Customer Note', { x: MARGIN_X, y: cursorY, size: 9, font: bold, color: BRAND_ORANGE })
    cursorY -= 12
    page.drawText(order.notes, { x: MARGIN_X, y: cursorY, size: 9, font: regular, color: MUTED, maxWidth: CONTENT_WIDTH })
  }

  return pdf.save()
}
