/**
 * ŞUBE BİLGİSİ (UBL cac:AgentParty) — belgede satıcı adresi neden şubenin değil?
 *
 * Mysoft'ta mükellef kaydı VKN BAŞINADIR ve UBL'deki `cac:AccountingSupplierParty`
 * (ünvan, adres, vergi dairesi) o kayıttan doldurulur: fatura gövdesinde satıcı
 * adresi alanı YOKTUR (Swagger v8 `InvoiceOutboxModel` — satıcı tarafında yalnız
 * `supplierAgentAccount` ve `supplierPartyIdentifer` var). Şube ana firmanın
 * VKN'siyle çalıştığı için (bkz. CLAUDE.md "Şube ≠ firma") farklı adresteki bir
 * şube fatura kestiğinde belgede ANA FİRMANIN adresi görünüyordu.
 *
 * UBL-TR'de bunun karşılığı AgentParty'dir: satıcının ŞUBE/birim bilgisi. Mysoft
 * modelinde `supplierAgentAccount`, GİB dizaynlarında (ve bizim taban
 * şablonlarımızda — sample-templates/*.xslt) "ŞUBE BİLGİLERİ" bloğu olarak basılır.
 * Şubenin kendi adresi belgeye BURADAN girer.
 *
 * Tüzel kişinin merkez adresi üstte KALIR ve kalmalıdır: orası vergi dairesine
 * kayıtlı adrestir, VKN'ye bağlıdır ve şube adresiyle değiştirilmesi doğru olmaz.
 */

/** `resolveBranchParty` için gereken firma alanları (Prisma select ile birebir). */
export type BranchPartyCompany = {
  name: string
  /** Belgedeki şube numarası (UBL `schemeID="SUBENO"`). Boşsa "1" varsayılır. */
  branchNo?: string | null
  address?: string | null
  city?: string | null
  district?: string | null
  phone?: string | null
  email?: string | null
  /** Dolu = bu firma bir ŞUBE. Ek firmada null'dır (kendi VKN'si → kendi mükellef kaydı). */
  parentCompanyId?: string | null
  parentCompany?: { address?: string | null; city?: string | null } | null
}

/** Belgeye "ŞUBE BİLGİLERİ" olarak girecek taraf. */
export type BranchParty = {
  /** Ünvan. Şube ayrı tüzel kişi olmadığı için ana firmayla AYNI ünvanı taşır. */
  name: string
  /**
   * Şube numarası. Mysoft bu alan boşken bloğu HİÇ üretmiyor ("SupplierParty.agentNumber
   * null olamaz" — ölçüldü), o yüzden firma doldurmadıysa tek şubeli işletme için doğru
   * olan "1" gönderilir.
   */
  branchNo: string
  address: string
  city: string
  /** İlçe. Girilmemişse provider `city`'ye geri düşer (UBL-TR zorunlu tutuyor). */
  district?: string
  phone?: string
  email?: string
}

/** Karşılaştırma için sadeleştirme: boşluklar tek, büyük/küçük harf duyarsız (TR). */
const norm = (value?: string | null) =>
  (value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("tr")

/**
 * Faturayı kesen firma için şube tarafını çözer; şube değilse ya da belgeye
 * yazılacak yeni bir bilgi yoksa `null` döner.
 *
 * `null` dönen her durum bilinçlidir:
 *  - ŞUBE DEĞİL (ana firma / ek firma): mükellef kaydındaki adres zaten firmanın
 *    kendi adresidir, ikinci kez yazmak belgede aynı adresi iki kez gösterirdi.
 *  - ADRES ANA FİRMAYLA AYNI: aynı adreste ikinci bir kayıt (ör. yalnız ayrı kasa
 *    tutmak için açılmış şube) — "ŞUBE BİLGİLERİ" bloğu bilgi katmaz.
 *  - ADRES/ŞEHİR EKSİK: UBL-TR'de `cac:PostalAddress` içinde İl ve İlçe ZORUNLUDUR;
 *    yarım adres gönderirsek GİB şematronu faturanın TAMAMINI reddeder. Yarım bilgiyle
 *    belge riske atılmaz — eksik alan `branchPartyWarning` ile loglanır.
 */
export function resolveBranchParty(
  company: BranchPartyCompany | null | undefined,
): BranchParty | null {
  if (!company?.parentCompanyId) return null

  const address = (company.address || "").trim()
  const city = (company.city || "").trim()
  if (!address || !city) return null

  const parent = company.parentCompany
  if (norm(address) === norm(parent?.address) && norm(city) === norm(parent?.city)) {
    return null
  }

  const district = (company.district || "").trim()
  const phone = (company.phone || "").trim()
  const email = (company.email || "").trim()

  return {
    name: (company.name || "").trim(),
    branchNo: (company.branchNo || "").trim() || "1",
    address,
    city,
    ...(district ? { district } : {}),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
  }
}

/**
 * Şube adresi EKSİK olduğu için belgeye yazılamayacaksa kullanıcıya/loga
 * gidecek uyarı; başka durumda boş döner. Sessizce eski (ana firma) adresle
 * göndermek, kullanıcının göremediği bir hatadır.
 */
export function branchPartyWarning(company: BranchPartyCompany | null | undefined): string {
  if (!company?.parentCompanyId) return ""
  const address = (company.address || "").trim()
  const city = (company.city || "").trim()
  if (address && city) return ""
  const missing = [!address && "adres", !city && "şehir"].filter(Boolean).join(" ve ")
  return `Şubenin ${missing} bilgisi boş — belgede ŞUBE BİLGİLERİ bloğu basılamaz ve satıcı adresi ana firmanın adresi olarak görünür. Ayarlar → Firma Bilgileri'nden doldurun.`
}
