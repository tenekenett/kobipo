// Salon planı geometrisi — ızgara hücresi cinsinden, saf fonksiyonlar.
//
// Tuval KAREDİR ve `grid × grid` hücreden oluşur. Piksel hiç geçmez: hücre boyu
// ekranda kapsayıcı genişliğinden türetilir (kenar çubuğu açılınca, telefonda,
// yazdırmada plan aynı kalsın diye). Bu yüzden kroki koordinatı hiçbir zaman
// çözünürlüğe bağlı olmaz.
//
// Kare olması bilinçli: dikdörtgen tuval "ne kadar yer var" sorusunu ekran
// oranına bağlıyordu — aynı plan geniş ekranda bol, dar ekranda dolu görünüyordu.

import { applyResize, type Rect, type ResizeHandle } from "@/lib/geometry/rect"

export { RESIZE_HANDLES, handleAnchor, handleCursor, type ResizeHandle } from "@/lib/geometry/rect"
export type { Rect } from "@/lib/geometry/rect"

/** Yeni planın kenar uzunluğu (hücre). 2×2 masayla ~50 masa alır. */
export const PLAN_GRID_DEFAULT = 16

/** Kullanıcıya sunulan kenar uzunlukları. Ara değer gerekmedi; liste seçmek
 *  serbest sayı girmekten hem hızlı hem hatasız. */
export const PLAN_GRID_STEPS = [10, 12, 16, 20, 24, 32, 40] as const

export const PLAN_GRID_MIN = PLAN_GRID_STEPS[0]
export const PLAN_GRID_MAX = PLAN_GRID_STEPS[PLAN_GRID_STEPS.length - 1]

/** Öğenin planda kapladığı yer. API alan adları (`width`/`height`) korunur. */
export interface PlanRect {
  x: number
  y: number
  width: number
  height: number
}

export const toRect = (r: PlanRect): Rect => ({ x: r.x, y: r.y, w: r.width, h: r.height })
export const fromRect = (r: Rect): PlanRect => ({ x: r.x, y: r.y, width: r.w, height: r.h })

/** Sunucudan/formdan gelen ızgara boyunu geçerli bir adıma oturtur. */
export function normalizeGrid(value: unknown, fallback = PLAN_GRID_DEFAULT): number {
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(PLAN_GRID_MAX, Math.max(PLAN_GRID_MIN, n))
}

/**
 * Dikdörtgeni kare ızgaranın içinde tutar. Önce ölçü kısılır, sonra konum
 * kaydırılır — ters sırada 40 hücrelik bir duvar 16'lık ızgarada `x`'i eksiye
 * itip sol kenardan taşardı.
 */
export function clampRectToGrid(rect: PlanRect, grid: number): PlanRect {
  const width = Math.max(1, Math.min(Math.round(rect.width), grid))
  const height = Math.max(1, Math.min(Math.round(rect.height), grid))
  return {
    width,
    height,
    x: Math.min(Math.max(Math.round(rect.x), 0), grid - width),
    y: Math.min(Math.max(Math.round(rect.y), 0), grid - height),
  }
}

/**
 * Verilen öğeleri kapsayan EN KÜÇÜK geçerli ızgara.
 *
 * Bölge kaydı olmayan ("Bölgesiz") plan boyutunu buradan alır: saklayacak satırı
 * olmadığı için boyutu içeriğinden türetilir. Ayrıca bölge küçültülürken alt
 * sınırı belirler — kullanıcı 24'lük planı 12'ye indirip masalarını tuvalin
 * dışında bırakamasın.
 */
export function requiredGrid(rects: PlanRect[], floor = PLAN_GRID_DEFAULT): number {
  let needed = floor
  for (const r of rects) {
    needed = Math.max(needed, r.x + r.width, r.y + r.height)
  }
  return normalizeGrid(needed, floor)
}

/** Ölçüyü büyütmeden `needed`'i karşılayan ilk adım (seçim listesi için). */
export function gridStepsFrom(needed: number): number[] {
  return PLAN_GRID_STEPS.filter((s) => s >= needed)
}

/**
 * Tutamaç sürüklemesini HÜCRE cinsinden uygular ve ızgaraya oturtur.
 *
 * Fark önce tam hücreye yuvarlanır, sonra dikdörtgene uygulanır: sırayı ters
 * kurmak 3.4 hücrelik bir kenarı yuvarlarken karşı kenarı da bir hücre
 * oynatıyordu (batı tutamacında dikdörtgen sürüklerken titriyordu).
 */
export function resizeInGrid(
  start: PlanRect,
  handle: ResizeHandle,
  dxCells: number,
  dyCells: number,
  grid: number,
): PlanRect {
  const moved = applyResize(toRect(start), handle, Math.round(dxCells), Math.round(dyCells), 1)
  return clampRectToGrid(fromRect(moved), grid)
}

/** Kalem jesti: basılan hücre ile bırakılan hücre arasındaki dikdörtgen. */
export function rectBetween(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  grid: number,
): PlanRect {
  return clampRectToGrid(
    {
      x: Math.min(ax, bx),
      y: Math.min(ay, by),
      width: Math.abs(bx - ax) + 1,
      height: Math.abs(by - ay) + 1,
    },
    grid,
  )
}

/** İki öğe üst üste biniyor mu (çakışma uyarısı ve bırakma hedefi için). */
export function rectsOverlap(a: PlanRect, b: PlanRect): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  )
}
