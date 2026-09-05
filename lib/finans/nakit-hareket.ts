/**
 * KASA/BANKA BAKİYESİNİ NE DEĞİŞTİRİR — tek tanım.
 *
 * `FinancialAccount.balance` yürüyen bir bakiyedir: yazma yolları onu tek tek
 * artırıp azaltır, tarihe göre yeniden hesaplanabilecek bir defter yoktur. Bu
 * yüzden "1 Ağustos'taki bakiye neydi" sorusunun tek cevabı, BUGÜNKÜ bakiyeden
 * o tarihten sonraki hareketleri geri sarmaktır — ve geri sarımın, yazma
 * yollarının bakiyeye uyguladığı işaretin BİREBİR aynısı olması gerekir.
 *
 * Yazma yolları ve bakiyeye etkileri:
 *
 *   Transaction INCOME    → +amount   (app/api/finans/transactions/route.ts)
 *   Transaction EXPENSE   → −amount
 *   Transaction TRANSFER  → −amount   (kaynak bacak; hedefe ayrı bir INCOME yazılır)
 *   InvoicePayment        → kanal verildiyse ARTIK daima bir Transaction üretir;
 *                           Transaction yazılmadan önce girilmiş ESKİ satırlarda
 *                           (transactionId null + accountId dolu) bakiye doğrudan
 *                           güncellenmişti: SALES +amount, diğer belge −amount
 *                           (app/api/faturalar/odemeler/route.ts).
 *
 * Bakiyeyi DEĞİŞTİRMEYEN tek şey `accountId` null olan fatura ödemesidir: belge
 * "ödendi" işaretlenmiştir ama parayı hangi kasanın aldığı yazılmamıştır. Rapor
 * bunları nakit sayarsa olmayan parayı akışa yazar.
 */

import { prisma } from "@/lib/db/prisma"

/**
 * Virman bacaklarının `reference` öneki. Hesaplar arası aktarımda KAYNAK hesaba
 * `type=TRANSFER`, HEDEF hesaba `type=INCOME` kaydı yazılır ve ikisi de bu önekle
 * işaretlenir. Hedef bacak gelir sayılırsa firma kendi cebinden cebine para
 * aktararak ciro/nakit akışı üretmiş görünür.
 *
 * DİKKAT: kaynak bacağın `reference`ı kullanıcı bir referans girdiyse onunla
 * değişir — bu yüzden kaynak `type`tan, hedef önekten tanınır.
 */
export const TRANSFER_REFERENCE_PREFIX = "TRANSFER:"

export type MaybeTransferLeg = { type?: string | null; reference?: string | null }

/** Hesaplar arası aktarımın bacağı mı — yani gerçek bir gelir/gider değil mi? */
export function isTransferLeg(tx: MaybeTransferLeg): boolean {
  if (String(tx.type || "").toUpperCase() === "TRANSFER") return true
  return Boolean(tx.reference?.startsWith(TRANSFER_REFERENCE_PREFIX))
}

/**
 * Prisma `where` parçası: virman bacaklarını DIŞLAR.
 *
 * `type` süzgeciyle birlikte kullanılır (`{ type: "INCOME", ...NOT_TRANSFER_WHERE }`);
 * INCOME/EXPENSE sorgusuna eklendiğinde geriye yalnız gerçek gelir/gider kalır.
 *
 * NEDEN `OR` + AÇIK NULL DALI — SQL'in üç değerli mantığı:
 * `NOT (reference LIKE 'TRANSFER:%')` ifadesi `reference` NULL iken TRUE değil
 * NULL üretir, satır da süzgeçten geçemez. Yani sade `NOT: { startsWith }` (ve
 * eşdeğeri `reference: { not: { startsWith } }`) REFERANSI OLMAYAN her hareketi
 * yutar — ki bunlar çoğunluktur. Canlı veride ölçüldü: iki serbest gelir
 * hareketi, toplam 2.065.445 ₺, iki formda da 0 dönüyordu; yani kâr/zarardaki
 * "Diğer Gelirler", nakit akışı, gelir-gider ve harcamalar raporu sessizce
 * sıfır basıyordu. Sadeleştirmeyin.
 *
 * DİKKAT: bu parça kendi `OR` anahtarını taşıdığı için, ZATEN `OR` içeren bir
 * `where` nesnesine yayılırsa (spread) diğerini sessizce ezer. Öyle bir sorguda
 * `AND: [{ ...NOT_TRANSFER_WHERE }, { OR: [...] }]` biçiminde sarmalayın.
 */
// `as const` YOK: Prisma'nın `OR` alanı değiştirilebilir bir dizi bekler,
// readonly tuple'ı kabul etmez.
export const NOT_TRANSFER_WHERE = {
  OR: [
    { reference: null },
    { NOT: { reference: { startsWith: TRANSFER_REFERENCE_PREFIX } } },
  ],
}

/** Bakiyeyi doğrudan değiştirmiş ESKİ fatura ödemeleri (Transaction'sız). */
export const LEGACY_CASH_PAYMENT_WHERE = {
  transactionId: null,
  accountId: { not: null },
} as const

/**
 * `since` tarihinden BUGÜNE kadarki net nakit hareketi (₺).
 *
 * Bakiyeyi geri sarmak için kullanılır: `o tarihteki bakiye = bugünkü bakiye −
 * cashMovementSince(o tarih)`. Virman bacakları BURADA sayılır — kaynak (−) ve
 * hedef (+) birbirini götürür; dışlansaydı eşleşmemiş bir virman (hedef hesabı
 * silinmiş/verilmemiş aktarım) bakiyeyi tutturmazdı.
 *
 * `accountsCreatedBefore` HESAP KÜMESİNİ DARALTIR ve `cashBalanceBefore` ile
 * BİREBİR aynı olmalıdır. Verilmezse geri sarım, bakiyesi toplama girmeyen bir
 * hesabın hareketlerini de düşürür ve olmayan bir eksi bakiye üretir: ölçüldü —
 * tek hesabı 2026'da açılmış bir firmada 2020 başlangıçlı dönem "dönem başı
 * −2.342.810 ₺" gösteriyordu; doğrusu 0.
 */
export async function cashMovementSince(
  companyId: string,
  since: Date,
  accountsCreatedBefore?: Date
): Promise<number> {
  const accountScope = accountsCreatedBefore
    ? { account: { createdAt: { lt: accountsCreatedBefore } } }
    : {}

  const [byType, legacyIn, legacyOut] = await Promise.all([
    prisma.transaction.groupBy({
      by: ["type"],
      where: { companyId, date: { gte: since }, ...accountScope },
      _sum: { amount: true },
    }),
    prisma.invoicePayment.aggregate({
      where: {
        companyId,
        ...LEGACY_CASH_PAYMENT_WHERE,
        ...accountScope,
        paymentDate: { gte: since },
        invoice: { type: "SALES" },
      },
      _sum: { amount: true },
    }),
    prisma.invoicePayment.aggregate({
      where: {
        companyId,
        ...LEGACY_CASH_PAYMENT_WHERE,
        ...accountScope,
        paymentDate: { gte: since },
        invoice: { type: { not: "SALES" } },
      },
      _sum: { amount: true },
    }),
  ])

  let total = 0
  for (const row of byType) {
    const amount = Number(row._sum.amount || 0)
    const type = String(row.type || "").toUpperCase()
    if (type === "INCOME") total += amount
    else if (type === "EXPENSE" || type === "TRANSFER") total -= amount
  }

  return (
    total + Number(legacyIn._sum.amount || 0) - Number(legacyOut._sum.amount || 0)
  )
}

/**
 * `boundary` anından HEMEN ÖNCEKİ toplam kasa+banka bakiyesi (sınır dışarıda).
 *
 * Sınır dışlayıcıdır ki iki uç aynı fonksiyonla sorulabilsin:
 *   dönem başı bakiyesi = cashBalanceBefore(başlangıç günü 00:00)
 *   dönem sonu bakiyesi = cashBalanceBefore(bitiş gününün ERTESİ 00:00)
 *
 * `isActive` süzgeci YOKTUR: pasife alınmış hesabın hareketleri de sayıldığı
 * için bakiyesi dışlanırsa dönem başı/sonu ekseni tutmaz. `createdAt` süzgeci
 * ise gerekli — o anda henüz açılmamış hesabın AÇILIŞ bakiyesi (hareket üretmez,
 * `financial_accounts.balance`a doğrudan yazılır) geriye sarılamaz ve geçmişe
 * sızardı. Dönem İÇİNDE açılan hesabın devri bu yüzden dönem sonunda vardır,
 * başında yoktur; fark nakit akışında "sınıflandırılmamış" satırına düşer.
 */
export async function cashBalanceBefore(companyId: string, boundary: Date): Promise<number> {
  const [current, movement] = await Promise.all([
    prisma.financialAccount.aggregate({
      where: { companyId, createdAt: { lt: boundary } },
      _sum: { balance: true },
    }),
    // Hareket kümesi bakiye kümesiyle AYNI: sınırdan sonra açılmış hesabın
    // bakiyesi toplamda yokken hareketleri düşülürse eksi bir hayalet doğar.
    cashMovementSince(companyId, boundary, boundary),
  ])
  return Number(current._sum.balance || 0) - movement
}
