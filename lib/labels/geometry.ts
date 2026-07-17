// Etiket Tasarımcısı — saf geometri yardımcıları (mm ↔ px, snap, resize).
// Component'lerden ayrı tutulur ki drag/resize matematiği test edilebilir olsun.

import type { LabelPage } from "./types"

/** 1 punto = 0.352778 mm (jsPDF setFontSize pt, koordinatlar mm). */
export const PT_TO_MM = 0.352778

/** CSS referans çözünürlüğü: 96px = 1inç = 25.4mm. */
export const BASE_PX_PER_MM = 96 / 25.4

export function pxPerMm(zoom: number): number {
  return BASE_PX_PER_MM * zoom
}

export function mmToPx(mm: number, zoom: number): number {
  return mm * pxPerMm(zoom)
}

export function pxToMm(px: number, zoom: number): number {
  return px / pxPerMm(zoom)
}

/** 0.5mm ızgaraya yuvarlar (kayan nokta artıklarını da temizler). */
export function snapMm(v: number, step = 0.5): number {
  return Math.round((Math.round(v / step) * step) * 100) / 100
}

/**
 * Etiketin verilen tuval alanına sığdığı en büyük zoom adımını seçer.
 *
 * Gerekçe: zoom sabit %400 başlıyordu; bu 20×40mm'de doğru ama 80×40mm etiket
 * 96dpi'da 1209px eder ve dar bir laptopta tuval alanı ~450px'dir → etiket ekrana
 * sığmaz. Boyut değiştiğinde/açılışta buradan hesaplanan adıma inilir.
 *
 * Hiçbir adım sığmıyorsa (ör. A4 sayfa, çok küçük alan) en küçük adım döner —
 * kullanıcı yine de kaydırarak çalışabilir.
 */
export function fitZoom(
  pageWmm: number,
  pageHmm: number,
  availWpx: number,
  availHpx: number,
  steps: readonly number[],
): number {
  const smallest = steps[0] ?? 1
  if (!(availWpx > 0) || !(availHpx > 0)) return smallest
  if (!(pageWmm > 0) || !(pageHmm > 0)) return smallest

  const needWpx = pageWmm * BASE_PX_PER_MM
  const needHpx = pageHmm * BASE_PX_PER_MM
  // Her iki eksende de sığmalı → kısıtlayıcı olan eksen belirler.
  const raw = Math.min(availWpx / needWpx, availHpx / needHpx)

  let best = smallest
  for (const s of steps) {
    if (s <= raw && s > best) best = s
  }
  return best
}

export interface RectMm {
  x: number
  y: number
  w: number
  h: number
}

/** Öğeyi etiket sınırları içinde tutar (taşan öğe yazdırmada kırpılır). */
export function clampRectToPage(rect: RectMm, page: LabelPage): RectMm {
  const w = Math.min(rect.w, page.widthMm)
  const h = Math.min(rect.h, page.heightMm)
  return {
    x: Math.min(Math.max(rect.x, 0), page.widthMm - w),
    y: Math.min(Math.max(rect.y, 0), page.heightMm - h),
    w,
    h,
  }
}

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w"

export const RESIZE_HANDLES: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"]

const MIN_SIZE_MM = 1

/**
 * Tutamaç sürüklemesini dikdörtgene uygular. start = jest başındaki dikdörtgen,
 * dxMm/dyMm = jest başından bu yana toplam fark. Kenarlar min 1mm'de durur
 * (karşı kenar sabit kalır).
 */
export function applyResize(
  start: RectMm,
  handle: ResizeHandle,
  dxMm: number,
  dyMm: number
): RectMm {
  let { x, y, w, h } = start

  const west = handle.includes("w")
  const east = handle.includes("e")
  const north = handle.includes("n")
  const south = handle.includes("s")

  if (east) w = Math.max(MIN_SIZE_MM, start.w + dxMm)
  if (south) h = Math.max(MIN_SIZE_MM, start.h + dyMm)
  if (west) {
    const newW = Math.max(MIN_SIZE_MM, start.w - dxMm)
    x = start.x + (start.w - newW)
    w = newW
  }
  if (north) {
    const newH = Math.max(MIN_SIZE_MM, start.h - dyMm)
    y = start.y + (start.h - newH)
    h = newH
  }

  return { x, y, w, h }
}

/** Handle'a uygun CSS cursor değeri. */
export function handleCursor(handle: ResizeHandle): string {
  switch (handle) {
    case "n":
    case "s":
      return "ns-resize"
    case "e":
    case "w":
      return "ew-resize"
    case "ne":
    case "sw":
      return "nesw-resize"
    case "nw":
    case "se":
      return "nwse-resize"
  }
}

/**
 * Barkod öğesinde çubuk/rakam alan paylaşımı — DOM editörü ve PDF aynı
 * formülü kullanır (WYSIWYG). showText açıkken alt ~%28 (en çok 3mm) rakamlara
 * ayrılır; rakam puntosu bu şeride sığacak şekilde türetilir.
 */
export function barcodeTextLayout(hMm: number, showText: boolean): {
  barsH: number
  textH: number
  textPt: number
} {
  if (!showText) return { barsH: hMm, textH: 0, textPt: 0 }
  const textH = Math.min(3, hMm * 0.28)
  return {
    barsH: Math.max(1, hMm - textH - 0.3),
    textH,
    textPt: (textH / PT_TO_MM) * 0.85,
  }
}

/**
 * A4 sayfasına sığan sütun/satır sayısı. Etiket + boşluk adımıyla, kenar
 * boşluklarından başlayarak hesaplar (en az 1 döner).
 */
export function a4GridCapacity(page: LabelPage): { cols: number; rows: number } {
  const marginLeft = page.a4?.marginLeftMm ?? 5
  const marginTop = page.a4?.marginTopMm ?? 10
  const usableW = 210 - marginLeft * 2
  const usableH = 297 - marginTop * 2
  const cols = Math.max(1, Math.floor((usableW + page.gapXMm) / (page.widthMm + page.gapXMm)))
  const rows = Math.max(1, Math.floor((usableH + page.gapYMm) / (page.heightMm + page.gapYMm)))
  return { cols, rows }
}
