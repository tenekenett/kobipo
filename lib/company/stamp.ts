/**
 * FİRMA KAŞESİ — makbuzlarda firmanın imza alanına basılan kaşe/imza görseli.
 *
 * İki kaynak var:
 *   - AYARLAR (`CompanyStamp`, Ayarlar → Firma Bilgileri): firmanın makbuz kaşesi.
 *     Bilgisayardan yüklenir ya da e-Dönüşüm şablonlarındaki bir kaşeden alınır.
 *   - ŞABLON (`EInvoiceTemplate.options.stampDataUri`, e-Dönüşüm şablon tasarımcısı;
 *     e-Arşiv faturada zorunlu). Ayarlarda kaşe yoksa makbuz bunu basar — 2026-10-02'ye
 *     kadar tek kaynak buydu ve kaşesi olan 6 firmanın hepsi kaşeyi buraya yüklemişti.
 *
 * Seçim deterministiktir:
 *   1. firmanın KENDİ ayar kaşesi, 2. kendi şablon kaşesi; yoksa (yalnız ŞUBEDE)
 *      3. ana firmanın ayar kaşesi, 4. ana firmanın şablon kaşesi — şube aynı tüzel
 *      kişidir. Ek firma ayrı tüzel kişidir, hesap kökünün kaşesini DEVRALMAZ.
 *   Şablonlar arasında: gönderimde kullanılan (aktif) önce, sonra en son güncellenen.
 *   Gizlenen ("silinen") şablonun kaşesi kullanılmaz.
 *
 * Saf modül (istemci de okur): Prisma/sharp `stamp.server.ts`te.
 */

export type StampCandidate = {
  id: string
  companyId: string
  isActive: boolean
  hidden: boolean
  hasStamp: boolean
  updatedAt: Date
}

export type StampSource =
  | { kind: "settings"; companyId: string }
  | { kind: "template"; companyId: string; templateId: string }

/** Basılacak kaşe: PNG görsel + basım kutusu (pt). Görsel kutuya oranı korunarak sığar. */
export type CompanyStamp = {
  dataUri: string
  /** Görselin kendi piksel ölçüsü (en-boy oranı buradan). */
  pixelWidth: number
  pixelHeight: number
  boxWidthPt: number
  boxHeightPt: number
}

/** Ayarlardaki kaşenin makbuzdaki basım genişliği (mm). */
export const STAMP_WIDTH_MM = { min: 25, max: 60, default: 40 } as const
/** Kaşe hiçbir kaynakta bundan yüksek basılmaz — imza şeridi şişmesin. */
export const STAMP_MAX_HEIGHT_MM = 40

const MM_TO_PT = 72 / 25.4
/** CSS px → pt (96 dpi → 72 dpi). Şablon kaşesinin kutusu faturadaki HTML'den gelir. */
const PX_TO_PT = 0.75

export function clampStampWidthMm(value: unknown): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return STAMP_WIDTH_MM.default
  return Math.min(STAMP_WIDTH_MM.max, Math.max(STAMP_WIDTH_MM.min, n))
}

/** Ayar kaşesinin basım kutusu: seçilen genişlik, yükseklik üst sınırı. */
export function settingsStampBox(widthMm: number) {
  return { boxWidthPt: clampStampWidthMm(widthMm) * MM_TO_PT, boxHeightPt: STAMP_MAX_HEIGHT_MM * MM_TO_PT }
}

/** Şablon kaşesinin basım kutusu: tasarımcıdaki kutu (faturadaki boyut). */
export function templateStampBox(widthPx: number, heightPx: number) {
  return { boxWidthPt: widthPx * PX_TO_PT, boxHeightPt: heightPx * PX_TO_PT }
}

/** Şablon tasarımcısının kaşe kutusu sınırları (px) — `normalizeDesignOptions` ile aynı. */
const TEMPLATE_BOX_PX = { min: 40, max: 240 } as const

/**
 * TERS YÖN: ayar kaşesi şablon tasarımcısına alınırken kutu ölçüsü (px). Genişlik
 * makbuzdaki basım genişliğidir (mm → CSS px), yükseklik görselin oranından; ikisi
 * de tasarımcının 40–240 px aralığına sığdırılır, oran bozulmadan.
 */
export function templateBoxFromSettings(widthMm: number, pixelWidth: number, pixelHeight: number) {
  const ratio = pixelHeight > 0 && pixelWidth > 0 ? pixelHeight / pixelWidth : 1
  let w = (clampStampWidthMm(widthMm) * 96) / 25.4
  let h = w * ratio
  const shrink = Math.min(1, TEMPLATE_BOX_PX.max / w, TEMPLATE_BOX_PX.max / h)
  w *= shrink
  h *= shrink
  const clamp = (v: number) => Math.round(Math.min(TEMPLATE_BOX_PX.max, Math.max(TEMPLATE_BOX_PX.min, v)))
  return { stampWidth: clamp(w), stampHeight: clamp(h) }
}

/** Bir firmanın şablonları arasından kaşesi basılacak olanı seçer. */
export function pickStampTemplate(candidates: StampCandidate[]): StampCandidate | null {
  const usable = candidates.filter((c) => c.hasStamp && !c.hidden)
  if (!usable.length) return null
  return [...usable].sort(
    (a, b) =>
      Number(b.isActive) - Number(a.isActive) ||
      b.updatedAt.getTime() - a.updatedAt.getTime() ||
      a.id.localeCompare(b.id),
  )[0]
}

export function pickStampSource(args: {
  companyId: string
  /** Yalnız ŞUBEDE dolu; ek firmanın hesap kökü buraya VERİLMEZ. */
  parentCompanyId: string | null
  /** Ayarlarda kaşesi olan firmalar (firma + ana firma arasından). */
  settingsCompanyIds: string[]
  templates: StampCandidate[]
}): StampSource | null {
  for (const id of [args.companyId, args.parentCompanyId]) {
    if (!id) continue
    if (args.settingsCompanyIds.includes(id)) return { kind: "settings", companyId: id }
    const template = pickStampTemplate(args.templates.filter((t) => t.companyId === id))
    if (template) return { kind: "template", companyId: id, templateId: template.id }
  }
  return null
}
