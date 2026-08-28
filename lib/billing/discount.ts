// İNDİRİM KODU — değerlendirmenin TEK yeri.
//
// Kod hem "uygula" kutusunda (ön izleme) hem sipariş açılırken çalışır. İkisi aynı
// fonksiyonu çağırmak ZORUNDA: ayrı hesaplarsanız ekran "%20 indirim" der, sunucu
// listeden tahsil eder — ya da tersi. İstemcinin gönderdiği tutara asla güvenilmez;
// indirim daima kodun kendisinden, sunucudaki fiyattan yeniden hesaplanır.
//
// Para birimi: fiyatlar KDV DAHİL tutulur (bkz. lib/billing/vat.ts), indirim de KDV
// dahil tutar üzerinden hesaplanır. Faturada iskonto AYRI satır olur: kalem liste
// fiyatından yazılır, indirim InvoiceItem.discountAmount'a düşer — müşteri belgede
// hem liste fiyatını hem indirimi görür.

import { prisma } from "@/lib/db/prisma"
// Kod metni normalizasyonu istemciyle ORTAK (prisma'sız leaf modül).
import { normalizeDiscountCode } from "@/lib/billing/discount-code"

export { normalizeDiscountCode }

/** Kodun geçerli olduğu satış türü. */
export type DiscountScope = "KONTOR" | "PACKAGE"

export type DiscountEvaluation = {
  codeId: string
  /** Normalize edilmiş kod (belgeye/siparişe bu yazılır). */
  code: string
  description: string | null
  /** İndirim tutarı (TL, KDV dahil) — 2 haneye yuvarlanmış. */
  discountAmount: number
  /** Tahsil edilecek tutar = liste − indirim. */
  payable: number
  /** Liste tutarı (indirimsiz). */
  listAmount: number
  /** Abonelik yenilemelerinde de geçerli mi? */
  appliesToRenewals: boolean
}

export type DiscountResult =
  | { ok: true; discount: DiscountEvaluation }
  | { ok: false; error: string }

/** 2 ondalık — kuruş artığı taşımayalım (PayTR tutarı kuruşa çevirir). */
function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

/**
 * İndirim tutarının SAF hesabı (veritabanı gerektirmez, testlenebilir).
 *
 * İki sınır burada uygulanır:
 *  - indirimin sipariş tutarını AŞAMAMASI (kırpılır) — negatif tahsilat olmaz. Tam
 *    tutara eşitlenmesi serbesttir: %100 kupon meşrudur ve sipariş ücretsiz karşılanır,
 *  - kuruş yuvarlaması (PayTR tutarı kuruşa çevirir; yarım kuruş tahsilat olmaz).
 */
export function computeDiscountAmount(
  rule: { type: string; value: number },
  listAmount: number,
): number {
  const list = round2(listAmount)
  if (!(list > 0)) return 0
  let amount =
    rule.type === "PERCENT" ? round2((list * Number(rule.value)) / 100) : round2(Number(rule.value))
  if (amount > list) amount = list
  return amount > 0 ? amount : 0
}

/**
 * Kodu doğrular ve indirimi hesaplar.
 *
 * `ok:false` dönen her durumun kullanıcıya gösterilebilir bir sebebi vardır —
 * "geçersiz kod" deyip susmak, süresi dolmuş bir kampanyayı destek çağrısına çevirir.
 */
export async function evaluateDiscountCode(params: {
  code: string
  scope: DiscountScope
  /** Liste tutarı (TL, KDV dahil). */
  amount: number
  companyId: string
  now?: Date
}): Promise<DiscountResult> {
  const code = normalizeDiscountCode(params.code)
  if (!code) return { ok: false, error: "İndirim kodu boş." }

  const listAmount = round2(params.amount)
  if (!Number.isFinite(listAmount) || listAmount <= 0) {
    return { ok: false, error: "İndirim uygulanacak bir tutar yok." }
  }

  const now = params.now ?? new Date()
  const row = await prisma.discountCode.findUnique({ where: { code } })
  if (!row || !row.isActive) return { ok: false, error: "Bu kod geçersiz." }

  if (row.scope !== "ALL" && row.scope !== params.scope) {
    return {
      ok: false,
      error:
        row.scope === "KONTOR"
          ? "Bu kod yalnız kontör alımlarında geçerli."
          : "Bu kod yalnız paket/abonelik alımlarında geçerli.",
    }
  }
  if (row.startsAt && now < row.startsAt) return { ok: false, error: "Bu kod henüz başlamadı." }
  if (row.endsAt && now > row.endsAt) return { ok: false, error: "Bu kodun süresi dolmuş." }

  // Limitler KULLANIM kayıtlarından sayılır; kayıt yalnız ödeme başarılı olunca yazılır.
  if (row.maxRedemptions != null) {
    const used = await prisma.discountCodeRedemption.count({ where: { codeId: row.id } })
    if (used >= row.maxRedemptions) return { ok: false, error: "Bu kodun kullanım hakkı dolmuş." }
  }
  if (row.maxPerCompany != null) {
    const usedByCompany = await prisma.discountCodeRedemption.count({
      where: { codeId: row.id, companyId: params.companyId },
    })
    if (usedByCompany >= row.maxPerCompany) {
      return { ok: false, error: "Bu kodu daha önce kullandınız." }
    }
  }

  const discountAmount = computeDiscountAmount(
    { type: row.type, value: Number(row.value) },
    listAmount,
  )
  if (discountAmount <= 0) return { ok: false, error: "Bu kod bu tutarda indirim sağlamıyor." }

  // TAM BEDAVA (payable = 0) MEŞRU BİR SONUÇTUR. Eskiden burada "ücretsiz sipariş için
  // destekle görüşün" diye reddediliyordu; oysa panel %100 kupon oluşturmaya izin
  // veriyor ([[lib/billing/discount-input.ts]]) ve kod listede etkin görünüyordu — admin
  // kuponu kuruyor, kodu giren her müşteri hata alıyordu. Sipariş uçları payable = 0'ı
  // PayTR'a hiç göndermeden karşılar ([[lib/billing/free-order.ts]]).
  const payable = round2(listAmount - discountAmount)

  return {
    ok: true,
    discount: {
      codeId: row.id,
      code: row.code,
      description: row.description,
      discountAmount,
      payable,
      listAmount,
      appliesToRenewals: row.appliesToRenewals,
    },
  }
}

/**
 * Kullanım kaydını yazar — ödeme BAŞARILI olduğunda çağrılır.
 *
 * Idempotent: sipariş başına tek satır (benzersiz indeks). PayTR aynı bildirimi
 * birden çok kez gönderebildiği için ikinci çağrı sessizce yutulur; sayaç bir
 * siparişi iki kez saymaz.
 */
export async function recordDiscountRedemption(params: {
  codeId: string
  companyId: string
  orderKind: "KONTOR" | "PACKAGE"
  orderId: string
  amount: number
  isRenewal?: boolean
}): Promise<void> {
  try {
    await prisma.discountCodeRedemption.create({
      data: {
        codeId: params.codeId,
        companyId: params.companyId,
        orderKind: params.orderKind,
        kontorOrderId: params.orderKind === "KONTOR" ? params.orderId : null,
        packageOrderId: params.orderKind === "PACKAGE" ? params.orderId : null,
        amount: params.amount,
        isRenewal: Boolean(params.isRenewal),
      },
    })
  } catch (e: any) {
    // P2002 = benzersiz kısıt: bu sipariş zaten sayılmış. Diğer hatalar loglanır ama
    // ödemeyi geri çevirmez — para alınmıştır, kupon sayacı ikincil bilgidir.
    if (e?.code !== "P2002") {
      console.error("[discount] kullanım kaydı yazılamadı:", e?.message || e)
    }
  }
}
