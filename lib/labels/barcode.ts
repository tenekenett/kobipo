// Etiket Tasarımcısı — barkod/QR üretimi (yalnızca client; canvas kullanır).
// jsbarcode/qrcode dinamik import edilir ki ortak bundle'a girmesin
// (lib/pdf/invoice-pdf.ts'teki dinamik import konvansiyonu).
// Dönen PNG data-URL'ler hem DOM editöründe <img> hem jsPDF addImage'da
// kullanılır; ASLA persist edilmez (her render'da türetilir).

import type { BarcodeSymbology } from "./types"

/** İlk 12 haneden EAN-13 kontrol hanesini hesaplar. */
export function ean13CheckDigit(digits12: string): number {
  let sum = 0
  for (let i = 0; i < 12; i++) {
    const d = digits12.charCodeAt(i) - 48
    sum += i % 2 === 0 ? d : d * 3
  }
  return (10 - (sum % 10)) % 10
}

export function isValidEan13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false
  return ean13CheckDigit(value.slice(0, 12)) === Number(value[12])
}

/**
 * 12 haneli değere kontrol hanesi ekler; 13 haneli geçerli değeri aynen döner.
 * EAN olamayacak değerlerde null (çağıran Code128'e düşer veya placeholder basar).
 */
export function normalizeEan13(value: string): string | null {
  if (/^\d{12}$/.test(value)) return value + ean13CheckDigit(value)
  if (isValidEan13(value)) return value
  return null
}

/** auto: 12-13 haneli sayısal → EAN13 (checksum tutuyorsa), değilse Code128. */
export function effectiveSymbology(
  value: string,
  symbology: BarcodeSymbology
): "ean13" | "code128" {
  if (symbology === "ean13") return "ean13"
  if (symbology === "code128") return "code128"
  return normalizeEan13(value) !== null ? "ean13" : "code128"
}

/** Baskı netliği için hedef bitmap yoğunluğu (~203dpi termal yazıcı). */
const RASTER_PX_PER_MM = 8

/**
 * Barkodu hedef mm boyutuna uygun çözünürlükte PNG data-URL'e çizer.
 * Geçersiz değerde (boş, EAN checksum tutmaz, JsBarcode throw) null döner —
 * çağıran placeholder kutu gösterir, asla crash etmez.
 *
 * İki geçiş: önce modül sayısını ölç (width:1), sonra hedef genişliğe göre
 * tamsayı modül genişliğiyle yeniden çiz (bulanıklık olmadan ölçeklensin).
 */
export async function renderBarcodeDataUrl(
  value: string,
  symbology: BarcodeSymbology,
  wMm: number,
  hMm: number
): Promise<string | null> {
  const trimmed = (value || "").trim()
  if (!trimmed || typeof document === "undefined") return null

  const kind = effectiveSymbology(trimmed, symbology)
  let encodeValue = trimmed
  if (kind === "ean13") {
    const ean = normalizeEan13(trimmed)
    if (!ean) return null
    encodeValue = ean
  }

  try {
    const { default: JsBarcode } = await import("jsbarcode")
    const format = kind === "ean13" ? "EAN13" : "CODE128"
    const heightPx = Math.max(8, Math.round(hMm * RASTER_PX_PER_MM))

    // 1. geçiş: modül (en dar çubuk) sayısını öğren.
    const probe = document.createElement("canvas")
    JsBarcode(probe, encodeValue, {
      format,
      displayValue: false,
      margin: 0,
      width: 1,
      height: 10,
    })
    const modules = Math.max(1, probe.width)

    // 2. geçiş: hedef genişliğe en yakın tamsayı modül genişliği.
    const targetPx = Math.max(modules, Math.round(wMm * RASTER_PX_PER_MM))
    const barWidth = Math.max(1, Math.round(targetPx / modules))

    const canvas = document.createElement("canvas")
    JsBarcode(canvas, encodeValue, {
      format,
      displayValue: false,
      margin: 0,
      width: barWidth,
      height: heightPx,
      background: "#ffffff",
      lineColor: "#000000",
    })
    return canvas.toDataURL("image/png")
  } catch {
    // JsBarcode geçersiz girdide throw eder — placeholder'a düş.
    return null
  }
}

/** QR kodu PNG data-URL'e çizer (hata düzeltme M, kenar boşluksuz). */
export async function renderQrDataUrl(value: string, sizeMm: number): Promise<string | null> {
  const trimmed = (value || "").trim()
  if (!trimmed || typeof document === "undefined") return null
  try {
    const QRCode = (await import("qrcode")).default
    return await QRCode.toDataURL(trimmed, {
      margin: 0,
      width: Math.max(32, Math.round(sizeMm * RASTER_PX_PER_MM)),
      errorCorrectionLevel: "M",
    })
  } catch {
    return null
  }
}
