/**
 * FİRMA LOGOSU — Kobipo düzenindeki (resmî olmayan) fatura PDF'inin sağ üstüne basılan logo.
 *
 * Firmada ayrı bir logo alanı YOK; logo iki tasarım ekranında durur:
 *   - ŞABLON (`EInvoiceTemplate.options.logoDataUri`, Belge Şablonları → tasarımcı):
 *     firmanın resmî faturasında görünen logo. 2026-10-08 ölçümünde logolu 17 şablon vardı
 *     (Eren Forklift, Eren Vinç, Hidroeren, Reypo).
 *   - FİŞ (`Company.receiptTemplate.logoDataUrl`, Ayarlar → Fiş Tasarımı): e-Dönüşüm
 *     kullanmayan firmanın tek logo kaynağı.
 *
 * Seçim kaşeyle aynı eksende (bkz. stamp.ts): 1. firmanın şablon logosu, 2. fiş logosu;
 * yoksa (yalnız ŞUBEDE) 3–4. ana firmanınkiler — şube aynı tüzel kişidir. Ek firma ayrı
 * tüzel kişidir, hesap kökünün logosunu DEVRALMAZ. Şablonlar arasında aktif önce, sonra
 * belgenin türüne uyan (e-Arşiv faturada e-Arşiv şablonu: resmî hâlinde basılacak logo),
 * sonra en son güncellenen; gizlenen ("silinen") şablonun logosu kullanılmaz. Hiçbirinde
 * logo yoksa belgeye KOBİPO logosu basılır (kullanıcı kararı, 2026-10-08 — `loadDocumentLogo`).
 *
 * Şablonun tasarımı aynı Mysoft hesabındaki BAŞKA bir Kobipo kaydında yapılmışsa logo
 * oradan okunur (`designTemplateId`) — kural ve güvenlik sınırı `template-design.ts`te.
 *
 * Saf modül: Prisma/sharp `logo.server.ts`te.
 */

export type LogoCandidate = {
  id: string
  companyId: string
  /** 1 = e-Fatura, 2 = e-Arşiv. */
  eDocumentType: number
  isActive: boolean
  hidden: boolean
  hasLogo: boolean
  updatedAt: Date
  /**
   * Logonun okunacağı satır, satırın kendisi değilse: tasarım aynı Mysoft hesabındaki başka
   * bir kayıtta yapılmış (`template-design.ts`).
   */
  designTemplateId?: string
}

export type LogoSource =
  | { kind: "template"; companyId: string; templateId: string }
  | { kind: "receipt"; companyId: string }

/** Basılacak logo: PNG görsel + piksel ölçüsü (en-boy oranı buradan). */
export type CompanyLogo = {
  dataUri: string
  pixelWidth: number
  pixelHeight: number
  /** Firmanın logosu yok, yerine Kobipo logosu basılıyor (belgede daha küçük durur). */
  kobipo?: boolean
}

/** Faturanın türü → şablonun belge tipi (Manuel faturada tercih yok). */
export function logoDocTypeFor(invoiceType: string | null | undefined): number | null {
  if (invoiceType === "E_INVOICE") return 1
  if (invoiceType === "E_ARCHIVE") return 2
  return null
}

/** Bir firmanın şablonları arasından logosu basılacak olanı seçer. */
export function pickLogoTemplate(candidates: LogoCandidate[], docType: number | null = null): LogoCandidate | null {
  const usable = candidates.filter((c) => c.hasLogo && !c.hidden)
  if (!usable.length) return null
  const matches = (c: LogoCandidate) => Number(docType != null && c.eDocumentType === docType)
  return [...usable].sort(
    (a, b) =>
      Number(b.isActive) - Number(a.isActive) ||
      matches(b) - matches(a) ||
      b.updatedAt.getTime() - a.updatedAt.getTime() ||
      a.id.localeCompare(b.id),
  )[0]
}

export function pickLogoSource(args: {
  companyId: string
  /** Yalnız ŞUBEDE dolu; ek firmanın hesap kökü buraya VERİLMEZ. */
  parentCompanyId: string | null
  templates: LogoCandidate[]
  /** Fiş tasarımında logosu olan firmalar (firma + ana firma arasından). */
  receiptLogoCompanyIds: string[]
  /** Faturanın belge tipi (`logoDocTypeFor`); null = tercih yok. */
  docType?: number | null
}): LogoSource | null {
  for (const id of [args.companyId, args.parentCompanyId]) {
    if (!id) continue
    const template = pickLogoTemplate(
      args.templates.filter((t) => t.companyId === id),
      args.docType ?? null,
    )
    if (template) {
      return { kind: "template", companyId: id, templateId: template.designTemplateId ?? template.id }
    }
    if (args.receiptLogoCompanyIds.includes(id)) return { kind: "receipt", companyId: id }
  }
  return null
}
