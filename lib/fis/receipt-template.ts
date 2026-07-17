/**
 * Fiş (80mm termal) tasarım şablonu — firma başına tek, Company.receiptTemplate (jsonb).
 *
 * Etiket tasarımcısından (lib/labels/types.ts) ayrıdır ve olması gereken budur: etiket
 * sabit boyutlu tuvale mutlak konumlu elementler koyar; fiş ise değişken uzunlukta
 * (kalem sayısı kadar uzar) ve yerleşimi sabittir. Burada tasarlanan şey yerleşim değil,
 * fişin **sabit parçaları ve görünürlük tercihleri**: logo, üst başlık, alt not, hangi
 * bölümlerin görüneceği ve kağıt genişliği.
 *
 * Varsayılanlar, şablon hiç kaydedilmemiş firmalarda bugünkü çıktıyı birebir korur.
 */

export type ReceiptWidth = 80 | 58

export type ReceiptTemplate = {
  /** Fişin üstünde ortalı görünen logo (data URL). Boşsa logo çizilmez. */
  logoDataUrl: string | null
  /** Üst başlık; boşsa firma adı kullanılır. */
  headerText: string
  /** En altta ortalı not. Boşsa alt not bloğu hiç çıkmaz. */
  footerText: string
  /** Ara toplam + KDV satırları (kapalıysa yalnız TOPLAM görünür). */
  showVat: boolean
  /** Müşteri / Tedarikçi satırı. */
  showCounterparty: boolean
  /** Fiş notu (Invoice.notes) — hızlı satış/alışta satış anında girilir. */
  showNotes: boolean
  /** İşletme adresi (Company.address) — başlığın altında küçük punto. */
  showAddress: boolean
  /** Telefon + vergi dairesi/VKN (Company.phone / taxOffice / taxNumber). */
  showContact: boolean
  /** Kağıt genişliği (mm). */
  widthMm: ReceiptWidth
}

/**
 * Varsayılan şablon = bugünkü sabit fiş görünümü.
 * footerText satışta "teşekkür" satırıydı; yön farkı build sırasında uygulanır
 * (bkz. receipt-html.ts DEFAULT_SALES_FOOTER) — burada boş bırakılır ki
 * "şablon kaydedilmemiş" ile "alt notu bilerek sildim" ayrılabilsin.
 */
export const DEFAULT_RECEIPT_TEMPLATE: ReceiptTemplate = {
  logoDataUrl: null,
  headerText: "",
  footerText: "",
  showVat: true,
  showCounterparty: true,
  showNotes: true,
  // Adres ve iletişim varsayılan KAPALI: şablon kaydetmemiş firmalarda fiş bugünküyle
  // aynı kalsın. Ayarlar > Fiş Tasarımı'ndan açılır.
  showAddress: false,
  showContact: false,
  widthMm: 80,
}

const MAX_IMAGE_DATAURL_CHARS = 700_000
// Yalnız png/jpeg — yükleyici (lib/labels/raster.ts) zaten PNG'ye çevirir.
const IMAGE_DATAURL = /^data:image\/(?:png|jpeg);base64,/
const MAX_TEXT_CHARS = 120

function str(v: unknown, def = ""): string {
  return typeof v === "string" ? v : def
}

function bool(v: unknown, def: boolean): boolean {
  return typeof v === "boolean" ? v : def
}

/**
 * Gelen ham veriyi (DB jsonb / istek gövdesi) güvenli şablona çevirir.
 * Hiçbir alana güvenilmez: logo yalnız png/jpeg data URL ve boyut sınırlı,
 * metinler kırpılır, genişlik iki değerden biri. Bozuk alan → varsayılan.
 */
export function normalizeReceiptTemplate(raw: unknown): ReceiptTemplate {
  const p = (raw ?? {}) as Record<string, unknown>

  const logo = str(p.logoDataUrl)
  const logoDataUrl =
    logo && IMAGE_DATAURL.test(logo) && logo.length <= MAX_IMAGE_DATAURL_CHARS ? logo : null

  const widthMm: ReceiptWidth = p.widthMm === 58 ? 58 : 80

  return {
    logoDataUrl,
    headerText: str(p.headerText).slice(0, MAX_TEXT_CHARS).trim(),
    footerText: str(p.footerText).slice(0, MAX_TEXT_CHARS).trim(),
    showVat: bool(p.showVat, DEFAULT_RECEIPT_TEMPLATE.showVat),
    showCounterparty: bool(p.showCounterparty, DEFAULT_RECEIPT_TEMPLATE.showCounterparty),
    showNotes: bool(p.showNotes, DEFAULT_RECEIPT_TEMPLATE.showNotes),
    showAddress: bool(p.showAddress, DEFAULT_RECEIPT_TEMPLATE.showAddress),
    showContact: bool(p.showContact, DEFAULT_RECEIPT_TEMPLATE.showContact),
    widthMm,
  }
}
