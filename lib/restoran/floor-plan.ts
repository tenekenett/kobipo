// Salon planı geometrisi — ızgara hücresi cinsinden, saf fonksiyonlar.
//
// Kroki YATAYDIR: `cols × rows` hücre, hücrenin kendisi karedir. Piksel hiç
// geçmez (koordinatlar hücre cinsinden DB'de durur) — kenar çubuğu açılınca,
// telefonda, yazdırmada plan aynı kalsın diye. Bu yüzden kroki koordinatı
// hiçbir zaman çözünürlüğe bağlı olmaz.
//
// SAKLANAN TEK ÖLÇÜ SÜTUN SAYISIDIR (`RestaurantArea.gridSize`). Satır sayısı
// türetilir: tuval kartın genişliğini doldursun diye ızgara kutunun oranını
// alır (hesap tuvalde, piksel orada) ve içeriğin gerektirdiğinden az olamaz —
// `contentRows` alt sınırı verir. Sebep: hem salonlar hem ekranlar yataydır;
// kare tuval geniş ekranda ortada yüzen küçük bir kareye dönüşüyor, iki yanında
// kullanıcının işine yaramayan boşluk bırakıyordu. Satırı da saklamak ikinci bir
// ayar demekti; kutu oranı + içerik zaten doğru cevabı veriyor ve eski kare
// planlar (içeriği aşağıya inen) kendiliğinden korunuyor.

import { applyResize, type Rect, type ResizeHandle } from "@/lib/geometry/rect"

export { RESIZE_HANDLES, handleAnchor, handleCursor, type ResizeHandle } from "@/lib/geometry/rect"
export type { Rect } from "@/lib/geometry/rect"

/** Yeni planın SÜTUN sayısı. 2×2 masayla bir sırada 8 masa alır. */
export const PLAN_COLS_DEFAULT = 16

/** Kullanıcıya sunulan sütun sayıları. Ara değer gerekmedi; liste seçmek
 *  serbest sayı girmekten hem hızlı hem hatasız. */
export const PLAN_COLS_STEPS = [10, 12, 16, 20, 24, 32, 40] as const

export const PLAN_COLS_MIN = PLAN_COLS_STEPS[0]
export const PLAN_COLS_MAX = PLAN_COLS_STEPS[PLAN_COLS_STEPS.length - 1]

/** Kutu ne kadar basık olursa olsun bu kadar satır çizilir; altı "plan" değil,
 *  tek sıra masa olurdu. */
export const PLAN_ROWS_MIN = 3

/**
 * Izgaranın çizilebileceği mutlak tavan — `PLAN_COLS_MAX`tan (ayarın tavanı)
 * ayrıdır ve ondan yüksektir.
 *
 * Tuval ekranı doldurmak için ayarın ötesine uzuyor; bu uzamayı 40'ta kesmek,
 * derin bir planda (hücre küçüldüğü için sütun çok gerekiyor) tuvali kutudan dar
 * bırakıp tam da kaldırmak istediğimiz yan boşlukları geri getiriyordu. İçerik
 * sınırları da (`requiredCols`/`contentRows`) buraya kadar yükselebilmeli: 40'ta
 * kırpılırsa oraya konmuş bir masa başka bir ekranda tuvalin dışında kalırdı.
 */
export const PLAN_CELLS_MAX = 120

/** Öğenin planda kapladığı yer. API alan adları (`width`/`height`) korunur. */
export interface PlanRect {
  x: number
  y: number
  width: number
  height: number
}

export const toRect = (r: PlanRect): Rect => ({ x: r.x, y: r.y, w: r.width, h: r.height })
export const fromRect = (r: Rect): PlanRect => ({ x: r.x, y: r.y, width: r.w, height: r.h })

/** Sunucudan/formdan gelen sütun sayısını geçerli bir adıma oturtur. */
export function normalizeCols(value: unknown, fallback = PLAN_COLS_DEFAULT): number {
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(PLAN_COLS_MAX, Math.max(PLAN_COLS_MIN, n))
}

/**
 * İçeriğin gerektirdiği satır sayısı — planın DİKEY ALT SINIRI.
 *
 * Tuval satırını kutunun oranından hesaplar, ama bu sayının altına inemez: kare
 * ızgarada çizilmiş eski planların aşağı inen masaları yoksa tuvalin dışında
 * kalırdı. Aşağı doğru büyümenin yolu da bu — editörde alta fazladan boş satır
 * verilir (`editRows`), oraya bir öğe konunca plan o yüksekliği kalıcı kazanır.
 */
export function contentRows(rects: PlanRect[], floor = PLAN_ROWS_MIN): number {
  let rows = floor
  for (const r of rects) rows = Math.max(rows, r.y + r.height)
  return Math.min(PLAN_CELLS_MAX, rows)
}

/** Düzenleme kipinde gösterilen satır: planın altında hep çizilecek yer kalır. */
export function editRows(rows: number): number {
  return Math.min(PLAN_CELLS_MAX, rows + 2)
}

/**
 * Dikdörtgeni ızgaranın içinde tutar. Önce ölçü kısılır, sonra konum kaydırılır
 * — ters sırada 40 hücrelik bir duvar 16 sütunluk ızgarada `x`'i eksiye itip
 * sol kenardan taşardı.
 */
export function clampRect(rect: PlanRect, cols: number, rows: number): PlanRect {
  const width = Math.max(1, Math.min(Math.round(rect.width), cols))
  const height = Math.max(1, Math.min(Math.round(rect.height), rows))
  return {
    width,
    height,
    x: Math.min(Math.max(Math.round(rect.x), 0), cols - width),
    y: Math.min(Math.max(Math.round(rect.y), 0), rows - height),
  }
}

/**
 * Verilen öğeleri YATAYDA kapsayan en küçük geçerli sütun sayısı.
 *
 * Bölge kaydı olmayan ("Bölgesiz") plan genişliğini buradan alır: saklayacak
 * satırı olmadığı için ölçüsü içeriğinden türer. Ayrıca bölge daraltılırken alt
 * sınırı belirler — kullanıcı 24 sütunluk planı 12'ye indirip masalarını
 * tuvalin dışında bırakamasın. Dikey taraf `planRows`'un işi.
 */
export function requiredCols(rects: PlanRect[], floor = PLAN_COLS_DEFAULT): number {
  let needed = floor
  for (const r of rects) needed = Math.max(needed, r.x + r.width)
  return Math.min(PLAN_CELLS_MAX, Math.max(PLAN_COLS_MIN, needed))
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
  cols: number,
  rows: number,
): PlanRect {
  const moved = applyResize(toRect(start), handle, Math.round(dxCells), Math.round(dyCells), 1)
  return clampRect(fromRect(moved), cols, rows)
}

/** Kalem jesti: basılan hücre ile bırakılan hücre arasındaki dikdörtgen. */
export function rectBetween(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cols: number,
  rows: number,
): PlanRect {
  return clampRect(
    {
      x: Math.min(ax, bx),
      y: Math.min(ay, by),
      width: Math.abs(bx - ax) + 1,
      height: Math.abs(by - ay) + 1,
    },
    cols,
    rows,
  )
}

/** İki öğe üst üste biniyor mu (çakışma uyarısı ve bırakma hedefi için). */
export function rectsOverlap(a: PlanRect, b: PlanRect): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  )
}
