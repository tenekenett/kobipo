/**
 * MYSOFT ŞABLON ONAYI — e-Arşiv belgesi yalnız ONAYLI dizaynla basılır.
 *
 * 2026-09-14'te canlı Mysoft'ta ölçüldü (Reypo mükellefi, taslak PDF ucu):
 *
 *   xsltName = onaylı şablon            → belge üretildi
 *   xsltName = onay bekleyen şablon     → "E-Arşiv Fatura belge tipine ait uygun
 *   xsltName = olmayan şablon           →  belge görseli bulunamamıştır..."
 *   xsltName yok (+ isSendWithGeneralXsltIfDefaultNotExists=true) → aynı hata
 *
 * Yani `isSendWithGeneralXsltIfDefaultNotExists` bayrağı canlıda e-Arşiv için genel
 * dizayna DÜŞÜRMÜYOR (test ortamında düşürüyor — oradan bakıp "çalışıyor" denmesin).
 * e-Fatura'da GİB'in standart dizaynı devreye girdiği için aynı durum sessizce geçer;
 * e-Arşiv'de belge hiç üretilmez. Her `addTenantXslt` yüklemesi (tasarımcı kaydı,
 * "Yenile", gönderim öncesi otomatik tazeleme) Mysoft'ta onay sürecine girer —
 * onay elle ve saatler/günler sonra gelir (Reypo: 3–9 saat; Eren Forklift: 3 Eylül'de
 * yeniden yüklenen şablon 9 Eylül'den itibaren reddedildi, e-Arşiv 11 gün kesilemedi).
 *
 * Buradaki fonksiyonlar SAFTIR (ağ yok): provider "belge görseli" reddini alınca
 * mükellefin onaylı e-Arşiv şablonuna bir kez daha dener; hiç yoksa kullanıcıya
 * durumu (onay bekliyor / silinmiş) açıkça söyler. Tazeleme tarafı ise onaylı
 * kopyayı sessizce yeniden yüklemez (bkz. template-refresh.ts).
 */

export type TenantXsltEntry = {
  xsltName: string | null
  isApproved: boolean | null
  isDefault?: boolean | null
  approvedDate?: string | null
  eDocumentTypeEnumText?: string | null
}

export type TemplateStatus = "approved" | "pending" | "missing"

/**
 * Mysoft'un "bu belge tipi için uygun belge görseli yok" reddi mi? Ham mesaj:
 *   "E-Arşiv Fatura belge tipine ait uygun belge görseli bulunamamıştır. Portal
 *    üzerinde Firma Bilgileri > Belge Ayarları > Şablonlar tanımında belge görseli
 *    oluşturabilirsiniz."
 */
export function isTemplateNotFoundError(raw: unknown): boolean {
  if (typeof raw !== "string") return false
  return /belge g[öo]rseli/i.test(raw) && /bulunam/i.test(raw)
}

/** Mysoft'un `eDocumentTypeEnumText`i bizim belge tipimize (1/2) denk mi? Bilinmiyorsa geçer. */
export function entryMatchesDocType(entry: TenantXsltEntry, eDocumentType: number): boolean {
  const text = (entry.eDocumentTypeEnumText || "").trim()
  if (!text) return true
  const isArchive = /ar[şs]iv/i.test(text)
  return eDocumentType === 2 ? isArchive : !isArchive
}

const sameName = (a: string | null | undefined, b: string) =>
  (a || "").trim().localeCompare(b.trim(), "tr", { sensitivity: "base" }) === 0

/** İstenen şablonun mükellefteki durumu. */
export function templateStatus(
  entries: TenantXsltEntry[],
  eDocumentType: number,
  xsltName: string | null | undefined,
): TemplateStatus {
  if (!xsltName?.trim()) return "missing"
  const hit = entries
    .filter((e) => entryMatchesDocType(e, eDocumentType))
    .find((e) => sameName(e.xsltName, xsltName))
  if (!hit) return "missing"
  return hit.isApproved ? "approved" : "pending"
}

/**
 * Yedek olarak kullanılacak ONAYLI şablon: önce Mysoft varsayılanı, sonra en son
 * onaylanan. Deterministiktir — taslak oluşturma ve taslak PDF önizlemesi ayrı ayrı
 * çağırsa da aynı adı seçer, belge iki adımda farklı görünmez.
 */
export function pickApprovedXslt(
  entries: TenantXsltEntry[],
  eDocumentType: number,
  exclude?: string | null,
): string | null {
  const candidates = entries.filter(
    (e) =>
      e.isApproved === true &&
      Boolean(e.xsltName?.trim()) &&
      entryMatchesDocType(e, eDocumentType) &&
      !(exclude && sameName(e.xsltName, exclude)),
  )
  if (candidates.length === 0) return null
  candidates.sort((a, b) => {
    if (Boolean(a.isDefault) !== Boolean(b.isDefault)) return a.isDefault ? -1 : 1
    const ad = a.approvedDate || ""
    const bd = b.approvedDate || ""
    if (ad !== bd) return ad > bd ? -1 : 1
    return (a.xsltName || "").localeCompare(b.xsltName || "", "tr")
  })
  return candidates[0].xsltName!.trim()
}

/** Kullanıcıya gösterilecek açıklama — ham reddi Mysoft portalına yollayan metin yerine. */
export function templateNotFoundMessage(params: {
  xsltName: string | null | undefined
  status: TemplateStatus
  listFailed?: boolean
}): string {
  const { xsltName, status, listFailed } = params
  const name = xsltName?.trim()
  const son =
    "Mükellefte onaylı başka bir e-Arşiv şablonu da yok; Mysoft onaylayana kadar e-Arşiv kesilemez. " +
    "Durumu E-Dönüşüm → Belge Şablonları sayfasından izleyebilir, onay için Mysoft'a başvurabilirsiniz."
  if (listFailed) {
    return (
      `Mysoft bu e-Arşiv için belge görseli (şablon) bulamadı` +
      (name ? ` ("${name}")` : "") +
      `; şablon listesi de okunamadığı için durum doğrulanamadı. ` +
      son
    )
  }
  if (!name) {
    return `Bu firmada aktif bir e-Arşiv şablonu seçili değil ve Mysoft'ta varsayılan e-Arşiv dizaynı yok. ` + son
  }
  if (status === "pending") {
    return `"${name}" şablonu Mysoft'ta ONAY BEKLİYOR — e-Arşiv belgesi onaysız şablonla basılamıyor. ` + son
  }
  return `"${name}" şablonu Mysoft'ta bulunamadı (silinmiş ya da reddedilmiş olabilir). ` + son
}
