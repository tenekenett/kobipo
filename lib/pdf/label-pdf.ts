"use client"

// Etiket Tasarımcısı — yazdırmaya hazır PDF üretimi (client-side jsPDF).
// DOM editörüyle aynı LabelDesign modelini çizer (WYSIWYG): koordinatlar mm,
// metin satır yüksekliği 1.15, alan değerleri lib/labels/fields üzerinden.
//
// jsPDF tuzakları (bilerek böyle):
// - format:[w,h] orientation'a göre SESSİZCE takas edilir → orientation hep
//   explicit verilir (constructor + addPage).
// - setFontSize pt, koordinatlar mm (1pt = 0.352778mm).
// - doc.text y = baseline → ascent'i kendimiz ekleriz (rotasyonla da uyumlu).
// - setLineDashPattern sonraki çizimlere sızar → her kesik şekilden sonra reset.
// - ellipse merkez+yarıçap ister (bounding box değil).
// - addImage'ın rotation parametresi kullanılmaz; bitmap önceden döndürülür.

import type jsPDF from "jspdf"
import type {
  BarcodeElement,
  FontSpec,
  ImageElement,
  LabelDesign,
  LabelElement,
  LabelRotation,
  QrElement,
  ShapeElement,
  TextFit,
} from "@/lib/labels/types"
import type { LabelCompanyInfo, LabelProduct } from "@/lib/labels/fields"
import { resolveCodeValue, resolveFieldValue } from "@/lib/labels/fields"
import { PT_TO_MM, a4GridCapacity, barcodeTextLayout } from "@/lib/labels/geometry"
import { renderBarcodeDataUrl, renderQrDataUrl } from "@/lib/labels/barcode"
import { rotateImageDataUrl } from "@/lib/labels/raster"

export interface LabelPrintItem {
  product: LabelProduct
  quantity: number
}

const MAX_LABELS = 5000
// DOM ile hizalı metin metrikleri: CSS line-height 1.15; DejaVu ascent ≈ 0.92em.
const LINE_HEIGHT = 1.15
const ASCENT = 0.92

interface RectMm {
  x: number
  y: number
  w: number
  h: number
}

/** Noktayı (cx,cy) etrafında derece kadar (görsel olarak saat yönünde) döndürür. */
function rotatePoint(px: number, py: number, cx: number, cy: number, deg: number) {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = px - cx
  const dy = py - cy
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
}

/** Eksene hizalı dikdörtgeni 90° adımlarla döndürünce oluşan dikdörtgen. */
function rotateRect(r: RectMm, cx: number, cy: number, deg: LabelRotation): RectMm {
  if (deg === 0) return r
  const p1 = rotatePoint(r.x, r.y, cx, cy, deg)
  const p2 = rotatePoint(r.x + r.w, r.y + r.h, cx, cy, deg)
  return {
    x: Math.min(p1.x, p2.x),
    y: Math.min(p1.y, p2.y),
    w: Math.abs(p2.x - p1.x),
    h: Math.abs(p2.y - p1.y),
  }
}

/** CSS'in saat yönü rotasyonunu jsPDF'in saat yönü tersi açısına çevirir. */
function pdfAngle(rotation: LabelRotation): number {
  return (360 - rotation) % 360
}

/**
 * Metni kutu genişliğine göre kısaltır (gerekiyorsa sonuna "…" koyar).
 *
 * Etiket sabit boyutludur; taşan metin komşu çıkartmanın üstüne biner. İkili
 * arama ile sığan en uzun ön ek bulunur — karakter karakter denemek 5.000
 * etiketlik sayfada pahalı olur.
 */
function clipToWidth(doc: jsPDF, str: string, maxW: number): string {
  if (!str) return str
  if (doc.getTextWidth(str) <= maxW) return str

  const ell = "…"
  if (doc.getTextWidth(ell) > maxW) return ""

  let lo = 0
  let hi = str.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (doc.getTextWidth(str.slice(0, mid) + ell) <= maxW) lo = mid
    else hi = mid - 1
  }
  return str.slice(0, lo).trimEnd() + ell
}

function drawTextBlock(
  doc: jsPDF,
  fontName: string,
  str: string,
  el: { x: number; y: number; w: number; h: number; rotation: LabelRotation },
  font: FontSpec,
  fit: TextFit,
  ox: number,
  oy: number
) {
  if (!str) return
  doc.setFont(fontName, font.bold ? "bold" : "normal")
  doc.setTextColor(font.color)

  let sizePt = font.sizePt
  doc.setFontSize(sizePt)
  if (fit === "shrink") {
    // Tek satır: kutuya sığana dek küçült (alt sınır 4pt; kalanı taşar/kırpılır).
    while (sizePt > 4 && doc.getTextWidth(str) > el.w) {
      sizePt -= 0.5
      doc.setFontSize(sizePt)
    }
  }

  const lineH = sizePt * PT_TO_MM * LINE_HEIGHT
  const lines: string[] =
    fit === "wrap" ? (doc.splitTextToSize(str, el.w) as string[]) : [str]
  const maxLines = Math.max(1, Math.floor(el.h / lineH + 0.01))
  // ETİKET BÜYÜYEMEZ: belgelerde metni sarıp bloğu uzatırız, çıkartmada bu
  // mümkün değil — sığmayan metin komşu etikete taşar. Bu yüzden kutuya
  // sığmayan satır üç noktayla KISALTILIR (küçültme 4pt tabanına dayandığında
  // ya da sarma dışı modda tek satır uzun kaldığında devreye girer).
  const drawn = lines.slice(0, maxLines).map((line, i) => {
    const isLastDrawn = i === Math.min(lines.length, maxLines) - 1
    const overflowing = lines.length > maxLines && isLastDrawn
    return clipToWidth(doc, overflowing ? `${line} …` : line, el.w)
  })
  const ascentMm = sizePt * PT_TO_MM * ASCENT

  const cx = ox + el.x + el.w / 2
  const cy = oy + el.y + el.h / 2

  drawn.forEach((line, i) => {
    // Rotasyonsuz uzayda satırın baseline başlangıç noktası
    let sx = ox + el.x
    if (font.align === "center") sx = ox + el.x + el.w / 2
    else if (font.align === "right") sx = ox + el.x + el.w
    const sy = oy + el.y + i * lineH + ascentMm

    if (el.rotation === 0) {
      doc.text(line, sx, sy, { align: font.align })
    } else {
      const p = rotatePoint(sx, sy, cx, cy, el.rotation)
      doc.text(line, p.x, p.y, { align: font.align, angle: pdfAngle(el.rotation) })
    }
  })
}

/** Barkod/QR bitmap'leri etiket kopyaları arasında tekrar üretilmesin diye cache. */
type RasterCache = Map<string, string | null>

async function cachedRaster(
  cache: RasterCache,
  key: string,
  produce: () => Promise<string | null>
): Promise<string | null> {
  if (cache.has(key)) return cache.get(key) ?? null
  const result = await produce()
  cache.set(key, result)
  return result
}

async function drawBarcodeEl(
  doc: jsPDF,
  fontName: string,
  el: BarcodeElement,
  product: LabelProduct,
  ox: number,
  oy: number,
  cache: RasterCache
) {
  const value = resolveCodeValue(el, product).trim()
  const cx = ox + el.x + el.w / 2
  const cy = oy + el.y + el.h / 2
  const layout = barcodeTextLayout(el.h, el.showText)

  const dataUrl = value
    ? await cachedRaster(
        cache,
        `bc|${value}|${el.symbology}|${el.w.toFixed(1)}x${layout.barsH.toFixed(1)}|${el.rotation}`,
        async () => {
          const raw = await renderBarcodeDataUrl(value, el.symbology, el.w, layout.barsH)
          return raw ? rotateImageDataUrl(raw, el.rotation) : null
        }
      )
    : null

  if (!dataUrl) {
    // Geçersiz/boş barkod: etikette ham değeri (varsa) sade metin olarak bas —
    // etiket yine de bilgi taşısın; editör tarafı ayrıca uyarı gösterir.
    if (value) {
      drawTextBlock(
        doc,
        fontName,
        value,
        el,
        { sizePt: 7, bold: false, align: "center", color: "#000000" },
        "shrink",
        ox,
        oy
      )
    }
    return
  }

  const barsRect = rotateRect(
    { x: ox + el.x, y: oy + el.y, w: el.w, h: layout.barsH },
    cx,
    cy,
    el.rotation
  )
  doc.addImage(dataUrl, "PNG", barsRect.x, barsRect.y, barsRect.w, barsRect.h)

  if (el.showText && layout.textH > 0) {
    drawTextBlock(
      doc,
      fontName,
      value,
      {
        x: el.x,
        y: el.y + layout.barsH + 0.3,
        w: el.w,
        h: layout.textH,
        rotation: el.rotation,
      },
      { sizePt: layout.textPt, bold: false, align: "center", color: "#000000" },
      "shrink",
      ox,
      oy
    )
  }
}

async function drawQrEl(
  doc: jsPDF,
  el: QrElement,
  product: LabelProduct,
  ox: number,
  oy: number,
  cache: RasterCache
) {
  const value = resolveCodeValue(el, product).trim()
  if (!value) return
  const side = Math.min(el.w, el.h)
  const dataUrl = await cachedRaster(cache, `qr|${value}|${side.toFixed(1)}`, () =>
    renderQrDataUrl(value, side)
  )
  if (!dataUrl) return
  // Kare, kutu içinde ortalanır; 90° adım rotasyonlar karede konum değiştirmez.
  const x = ox + el.x + (el.w - side) / 2
  const y = oy + el.y + (el.h - side) / 2
  doc.addImage(dataUrl, "PNG", x, y, side, side)
}

function drawShapeEl(doc: jsPDF, el: ShapeElement, ox: number, oy: number) {
  const cx = ox + el.x + el.w / 2
  const cy = oy + el.y + el.h / 2

  doc.setDrawColor(el.strokeColor)
  doc.setLineWidth(el.strokeWidthMm)
  if (el.dashed) doc.setLineDashPattern([1.2, 0.8], 0)

  try {
    if (el.shape === "line") {
      // Kutunun ortasından geçen yatay çizgi; rotasyon uç noktaları döndürür.
      const p1 = rotatePoint(ox + el.x, cy, cx, cy, el.rotation)
      const p2 = rotatePoint(ox + el.x + el.w, cy, cx, cy, el.rotation)
      doc.line(p1.x, p1.y, p2.x, p2.y)
      return
    }

    const r = rotateRect({ x: ox + el.x, y: oy + el.y, w: el.w, h: el.h }, cx, cy, el.rotation)
    const style = el.fillColor ? "FD" : "S"
    if (el.fillColor) doc.setFillColor(el.fillColor)

    if (el.shape === "rect") {
      doc.rect(r.x, r.y, r.w, r.h, style)
    } else {
      // circle: jsPDF ellipse merkez + yarıçap ister
      doc.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, style)
    }
  } finally {
    // Dash deseni sonraki TÜM çizimlere sızar — mutlaka resetle.
    if (el.dashed) doc.setLineDashPattern([], 0)
  }
}

async function drawImageEl(
  doc: jsPDF,
  el: ImageElement,
  ox: number,
  oy: number,
  cache: RasterCache
) {
  const dataUrl = await cachedRaster(cache, `img|${el.id}|${el.rotation}`, () =>
    rotateImageDataUrl(el.dataUrl, el.rotation).then((v) => v)
  )
  if (!dataUrl) return
  const cx = ox + el.x + el.w / 2
  const cy = oy + el.y + el.h / 2
  const r = rotateRect({ x: ox + el.x, y: oy + el.y, w: el.w, h: el.h }, cx, cy, el.rotation)
  const format = dataUrl.startsWith("data:image/jpeg") ? "JPEG" : "PNG"
  doc.addImage(dataUrl, format, r.x, r.y, r.w, r.h)
}

async function drawLabel(
  doc: jsPDF,
  fontName: string,
  elements: LabelElement[],
  product: LabelProduct,
  company: LabelCompanyInfo,
  ox: number,
  oy: number,
  cache: RasterCache
) {
  for (const el of elements) {
    switch (el.type) {
      case "text":
        drawTextBlock(doc, fontName, el.text, el, el.font, el.fit, ox, oy)
        break
      case "field":
        drawTextBlock(
          doc,
          fontName,
          resolveFieldValue(el, product, company),
          el,
          el.font,
          el.fit,
          ox,
          oy
        )
        break
      case "barcode":
        await drawBarcodeEl(doc, fontName, el, product, ox, oy, cache)
        break
      case "qr":
        await drawQrEl(doc, el, product, ox, oy, cache)
        break
      case "shape":
        drawShapeEl(doc, el, ox, oy)
        break
      case "image":
        await drawImageEl(doc, el, ox, oy, cache)
        break
    }
  }
}

/**
 * Tasarımı, seçilen ürünler × adet kadar etikete basıp PDF Blob döner.
 * ROLL: sayfa = bir sıra etiket (columns yanyana), sayfa boyutu etikete eşit.
 * A4: 210×297 gride yerleşim (kenar boşlukları + aralıklar tasarımdan).
 */
export async function generateLabelPdf(
  design: LabelDesign,
  items: LabelPrintItem[],
  company: LabelCompanyInfo
): Promise<Blob> {
  const queue: LabelProduct[] = []
  for (const item of items) {
    const qty = Math.max(1, Math.floor(item.quantity || 1))
    for (let i = 0; i < qty; i++) queue.push(item.product)
  }
  if (queue.length === 0) {
    throw new Error("Yazdırılacak ürün seçilmedi")
  }
  if (queue.length > MAX_LABELS) {
    throw new Error(`Tek seferde en fazla ${MAX_LABELS} etiket basılabilir`)
  }

  const [{ default: JsPdf }, { registerTurkishFontClient, TURKISH_PDF_FONT }] =
    await Promise.all([import("jspdf"), import("./unicode-font")])

  const page = design.page
  const elements = [...design.elements].sort((a, b) => a.z - b.z)

  let doc: jsPDF
  let slots: Array<{ x: number; y: number }>
  let addNextPage: (d: jsPDF) => void

  if (page.labelType === "A4") {
    doc = new JsPdf({ unit: "mm", format: "a4", orientation: "portrait" })
    const { cols, rows } = a4GridCapacity(page)
    const marginLeft = page.a4?.marginLeftMm ?? 5
    const marginTop = page.a4?.marginTopMm ?? 10
    slots = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        slots.push({
          x: marginLeft + c * (page.widthMm + page.gapXMm),
          y: marginTop + r * (page.heightMm + page.gapYMm),
        })
      }
    }
    addNextPage = (d) => d.addPage("a4", "portrait")
  } else {
    const cols = Math.max(1, page.columns)
    const pw = cols * page.widthMm + (cols - 1) * page.gapXMm
    const ph = page.heightMm
    // KRİTİK: jsPDF format:[w,h] değerlerini orientation'a göre takas eder —
    // 40×20'lik sayfanın 20×40 olmaması için orientation explicit verilir.
    const orientation = pw >= ph ? "landscape" : "portrait"
    doc = new JsPdf({ unit: "mm", format: [pw, ph], orientation })
    slots = []
    for (let c = 0; c < cols; c++) {
      slots.push({ x: c * (page.widthMm + page.gapXMm), y: 0 })
    }
    addNextPage = (d) => d.addPage([pw, ph], orientation)
  }

  await registerTurkishFontClient(doc)
  const cache: RasterCache = new Map()

  for (let i = 0; i < queue.length; i++) {
    if (i > 0 && i % slots.length === 0) addNextPage(doc)
    const slot = slots[i % slots.length]
    await drawLabel(doc, TURKISH_PDF_FONT, elements, queue[i], company, slot.x, slot.y, cache)
  }

  return doc.output("blob")
}
