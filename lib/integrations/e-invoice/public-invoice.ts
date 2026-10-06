/**
 * KAMU FATURASI — kamu kurumuna kesilen e-Faturada IBAN ve harcama birimi.
 *
 * Kamu kurumuna (GİB kaydında `gibUserType = 2`) kesilen e-Faturada ödemenin
 * yatırılacağı IBAN belgede ZORUNLUDUR (UBL `cac:PaymentMeans/cac:PayeeFinancialAccount`).
 * Mysoft bunu profilden BAĞIMSIZ arıyor: TİCARİ profilli taslak "Kamuya düzenlenen
 * belgelerde PaymentMeans.PayeeFinancialAccount alanı ilgili değerler ile
 * doldurulmalıdır" ile reddedildi (Eren Vinç → Pamukkale Üniversitesi, 2026-10-06 —
 * Kobipo'nun ilk kamu alıcısı; o güne kadar bu alan hiç gönderilmiyordu).
 *
 * Ölçüm (2026-10-06, Eren'in mükellefi, önizleme XML + canlı GİB şematronu):
 *  - `paymentMeans[].payeeFinancialAccount` → belgede `cac:PaymentMeans` + IBAN.
 *  - `profile: "KAMU"` → `cbc:ProfileID KAMU`; IBAN'sız KAMU şematrondan DÖNER
 *    ("geçerli bir Türkiye IBAN numarası yazılmalıdır").
 *  - `publicServicePayee*` → `cac:BuyerCustomerParty` (ödemeyi yapacak HARCAMA
 *    BİRİMİ). Şematron zorunlu tutmuyor; Mysoft swagger'ı KAMU profilinde zorunlu
 *    diyor. Belgenin alıcısı çoğu zaman MUHASEBE birimidir (posta kutusu
 *    defaultpk@muhasebat.gov.tr); harcama birimi ayrı VKN'li olabilir ve kurumdan
 *    öğrenilir — TAHMİN EDİLMEZ, alıcının bilgileriyle doldurulmaz.
 *
 * Karar:
 *  - Harcama birimi girilmişse belge tam KAMU senaryosuyla gider (profil KAMU +
 *    IBAN + harcama birimi).
 *  - Girilmemişse kullanıcının profili (Ticari/Temel) korunur ve yalnız IBAN eklenir
 *    — Mysoft'un istediği tam olarak budur; KAMU profilini harcama birimsiz göndermek
 *    swagger'daki zorunluluğa takılırdı.
 *  - İADE'de profil Mysoft gereği TEMELFATURA kalır; IBAN yine eklenir.
 *
 * IBAN seçimi: müşteri kartında seçilen banka hesabı; seçilmemişse firmanın TEK
 * uygun hesabı (aktif, BANKA, TL, geçerli TR IBAN). Birden çok uygun hesap varsa
 * Kobipo seçmez — hangi hesaba ödeneceği kullanıcının kararıdır.
 *
 * Saf modül; okuma/yazma `public-invoice.server.ts`.
 */

/** GİB hesap modelinde kamu kurumu (`gibUserType`: 1 özel, 2 kamu). */
export const KAMU_GIB_USER_TYPE = 2

/** Havale/EFT — Mysoft `paymentMeansCode` listesinden. */
export const KAMU_PAYMENT_MEANS_CODE = "42"

export type PublicInvoiceAccount = {
  id: string
  name: string
  type: string
  iban: string | null
  currency: string
  isActive: boolean
}

export type PublicPayee = {
  vkn: string
  name: string
  city: string
  district: string
}

/** Belgeye giden kamu bilgisi (provider `invoiceData.publicInvoice`). */
export type PublicInvoiceData = {
  iban: string
  /** Kobipo'daki hesap adı — yalnız günlük/mesaj içindir, belgeye yazılmaz. */
  accountName: string
  payee: PublicPayee | null
}

export type PublicPayeeInput = {
  vkn?: string | null
  name?: string | null
  city?: string | null
  district?: string | null
}

const ACCOUNTS_PAGE = "Finans → Finans Kanalları"
const CARD_SECTION = "müşteri kartında (Kimlik Bilgileri → Kamu kurumu)"

/** Boşlukları atar, büyük harfe çevirir ("TR66 0020 ..." → "TR660020..."). */
export function normalizeIban(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/[\s-]/g, "")
    .toUpperCase()
}

/**
 * Türkiye IBAN'ı mı? TR + 24 rakam (26 karakter) ve ISO 13616 mod-97 = 1.
 * GİB şematronu KAMU profilinde "geçerli bir Türkiye IBAN numarası" ister; hatalı
 * IBAN'ı göndermeden yakalamak, belgenin tamamen reddedilmesinden iyidir.
 */
export function isValidTrIban(raw: string | null | undefined): boolean {
  const iban = normalizeIban(raw)
  if (!/^TR\d{24}$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const digits = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55)
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97
  }
  return remainder === 1
}

/** Kamu faturasında IBAN'ı belgeye yazılabilecek hesap mı? */
export function isEligiblePublicAccount(account: PublicInvoiceAccount): boolean {
  return (
    account.isActive &&
    account.type === "BANK" &&
    String(account.currency || "TRY").toUpperCase() === "TRY" &&
    isValidTrIban(account.iban)
  )
}

function accountProblem(account: PublicInvoiceAccount): string | null {
  if (!account.isActive) return "pasif"
  if (account.type !== "BANK") return "banka hesabı değil"
  if (String(account.currency || "TRY").toUpperCase() !== "TRY") return "TL hesabı değil"
  if (!normalizeIban(account.iban)) return "IBAN'ı girilmemiş"
  if (!isValidTrIban(account.iban)) return "IBAN'ı geçersiz"
  return null
}

/**
 * Harcama birimi: VKN girilmişse ünvan ve il zorunlu, ilçe boşsa il'e düşer (UBL-TR'de
 * ilçe zorunlu; aynı geri düşme alıcı ve şube adresinde de var). VKN boşsa birim yok.
 */
export function resolvePublicPayee(
  input: PublicPayeeInput | null | undefined,
): { ok: true; payee: PublicPayee | null } | { ok: false; error: string } {
  const vkn = String(input?.vkn ?? "").replace(/\D/g, "")
  const name = String(input?.name ?? "").trim()
  const city = String(input?.city ?? "").trim()
  const district = String(input?.district ?? "").trim()
  if (!vkn) {
    if (name || city) {
      return { ok: false, error: "Harcama biriminin VKN'si girilmemiş — tamamlayın ya da birimin bütün alanlarını boşaltın." }
    }
    return { ok: true, payee: null }
  }
  if (vkn.length !== 10) {
    return { ok: false, error: `Harcama biriminin VKN'si 10 haneli olmalı ("${vkn}").` }
  }
  if (!name || !city) {
    return { ok: false, error: "Harcama biriminin ünvanı ve ili zorunlu." }
  }
  return { ok: true, payee: { vkn, name, city, district: district || city } }
}

/**
 * Kamu faturasının belgeye gidecek bilgisi. Alıcı kamu değilse `data: null` (belge
 * değişmez). Hata metni kullanıcıya olduğu gibi gösterilir: ne yapacağını söyler.
 */
export function resolvePublicInvoice(input: {
  isPublic: boolean
  /** Müşteri kartında seçilen hesap (yoksa null). */
  selectedAccountId: string | null
  /** Firmanın hesapları — pasifler dahil (seçili hesap pasife alınmış olabilir). */
  accounts: PublicInvoiceAccount[]
  payee: PublicPayeeInput | null
}): { ok: true; data: PublicInvoiceData | null } | { ok: false; error: string } {
  if (!input.isPublic) return { ok: true, data: null }

  let account: PublicInvoiceAccount | undefined
  if (input.selectedAccountId) {
    const selected = input.accounts.find((a) => a.id === input.selectedAccountId)
    if (!selected) {
      return {
        ok: false,
        error: `Alıcı kamu kurumu: ${CARD_SECTION} seçili ödeme hesabı bulunamadı. Hesabı yeniden seçin.`,
      }
    }
    const problem = accountProblem(selected)
    if (problem) {
      return {
        ok: false,
        error: `Alıcı kamu kurumu: ${CARD_SECTION} seçili ödeme hesabı "${selected.name}" ${problem}. Kamu faturasında ödemenin yatırılacağı TL hesabın geçerli IBAN'ı zorunlu — hesabı ${ACCOUNTS_PAGE} ekranında düzeltin ya da başka hesap seçin.`,
      }
    }
    account = selected
  } else {
    const eligible = input.accounts.filter(isEligiblePublicAccount)
    if (eligible.length === 0) {
      return {
        ok: false,
        error: `Alıcı kamu kurumu: kamuya kesilen faturada ödemenin yatırılacağı IBAN zorunlu, ama firmada IBAN'ı geçerli, aktif bir TL banka hesabı yok. ${ACCOUNTS_PAGE} ekranında hesabın IBAN'ını girin.`,
      }
    }
    if (eligible.length > 1) {
      return {
        ok: false,
        error: `Alıcı kamu kurumu: kamuya kesilen faturada ödemenin yatırılacağı IBAN zorunlu. Firmada ${eligible.length} banka hesabı var (${eligible.map((a) => a.name).join(", ")}); hangisine ödeneceğini ${CARD_SECTION} seçin.`,
      }
    }
    account = eligible[0]
  }

  const payee = resolvePublicPayee(input.payee)
  if (!payee.ok) return { ok: false, error: `Alıcı kamu kurumu: ${payee.error} Düzeltme yeri: ${CARD_SECTION}.` }

  return {
    ok: true,
    data: { iban: normalizeIban(account.iban), accountName: account.name, payee: payee.payee },
  }
}

/**
 * Belge profili KAMU mu olacak? Yalnız harcama birimi biliniyorsa (yukarıdaki karar);
 * İADE'de Mysoft TEMELFATURA ister.
 */
export function usesKamuProfile(data: PublicInvoiceData | null | undefined, isReturn: boolean): boolean {
  return Boolean(data?.payee) && !isReturn
}

/**
 * Mysoft'un kamu reddine kullanıcıya ne yapacağını söyleyen ek. GİB sorgusu
 * yapılamadığında ve kart "kamu" işaretli olmadığında belge IBAN'sız gidebilir;
 * Mysoft'un "PayeeFinancialAccount" diyen mesajı tek başına anlaşılmaz.
 */
export function publicInvoiceErrorHint(rawError: string | null | undefined): string | null {
  const text = String(rawError ?? "").toLocaleLowerCase("tr-TR")
  if (text.includes("payeefinancialaccount") || text.includes("kamuya düzenlenen")) {
    return `Alıcı kamu kurumu: ${CARD_SECTION} "Kamu kurumu"nu açıp ödemenin yatırılacağı banka hesabını seçin, sonra yeniden deneyin.`
  }
  if (text.includes("harcama birimi") || text.includes("publicservicepayee") || text.includes("buyercustomerparty")) {
    return `Kamu faturasında harcama birimi bilgisi isteniyor: ${CARD_SECTION} harcama biriminin VKN, ünvan ve il/ilçesini girin (kurumdan öğrenilir).`
  }
  return null
}
