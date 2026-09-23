import { prisma } from "@/lib/db/prisma"
import { getCariCheckNoteCredit } from "@/lib/cari/check-credit"
import { invoiceBalanceEffect } from "@/lib/cari/invoice-direction"
import { virmanNetForParty } from "@/lib/cari/virman-db"
import { computeCariAging } from "@/lib/raporlar/cari-yaslandirma"

/**
 * Bir cari (müşteri/tedarikçi) kaydının silinebilir / arşivlenebilir olup
 * olmadığını ve engelleyen sebepleri hesaplar.
 *
 * Kurallar:
 * - Açık bakiye  → hem silmeyi hem arşivlemeyi engeller.
 * - Açık fatura  → hem silmeyi hem arşivlemeyi engeller.
 * - Geçmiş kayıt → yalnızca silmeyi engeller (arşivlemeye yönlendirilir).
 *
 * Yani temiz (bakiyesiz, açık faturasız, geçmişsiz) kayıt silinebilir;
 * geçmişi olan ama bakiyesi/açık faturası olmayan kayıt arşivlenebilir.
 *
 * ── Kendi formülü YOK (2026-09-23) ──────────────────────────────────────────
 * Burası bakiyeyi ayrı bir formülle kuruyordu ve listeden ayrışmıştı. Canlı
 * ölçümde (lib/cari/bakiye-tutarlilik.canli.test.ts, 464 cari) 4 cari listede
 * 0 bakiyeli olduğu halde "açık bakiye var" diye ARŞİVLENEMİYORDU:
 *   - iptal edilmiş fatura sayılıyordu (durum süzgeci yoktu) — 3 cari,
 *     7.200 / 8.400 / 12,60 TL;
 *   - kartın karşı yönlü (mahsup) faturası ve iadeler hiç sayılmıyordu —
 *     tedarikçi kartına işlenmiş 3.231 TL'lik satış, aynı tutardaki alışı
 *     kapatmıyordu.
 * Artık:
 *   - BAKİYE kart uçlarıyla aynı formül: iptal/dönüşmüş hariç her fatura
 *     kendi yönüyle (`receivableSign`/`payableSign`), kasaya bağlanmamış
 *     ödemesi düşülerek; cariye bağlı işlem, çek/senet, açılış ve virman.
 *   - AÇIK FATURA sorusunu yaşlandırma raporu cevaplar (taslaklar dahil):
 *     serbest tahsilat, çek, iade, mahsup ve virman kredilerini açık
 *     kalemlere eskiden yeniye o uygular. Burada ikinci bir kopyası
 *     tutulsaydı iki ekran yine ayrışırdı.
 */
export interface CariDeletability {
  hasOpenBalance: boolean
  hasOpenInvoices: boolean
  hasHistory: boolean
  canDelete: boolean
  canArchive: boolean
  /** Silmeyi engelleyen sebepler (insan-okur metin). */
  deleteBlockReasons: string[]
  /** Arşivlemeyi engelleyen sebepler (insan-okur metin). */
  archiveBlockReasons: string[]
}

export const REASON_OPEN_BALANCE = "Hesabın açık bakiyesi var."
export const REASON_OPEN_INVOICES = "Hesaba ait açık faturalar var."
export const REASON_HISTORY =
  "Hesaba ait geçmiş faturalar, ödeme/tahsilat ya da virman kayıtları var."

const EPSILON = 0.01

/** Bakiyeye giren faturalar — liste ve kart uçlarıyla aynı durum süzgeci. */
const POSTED_INVOICE_STATUS = { notIn: ["CANCELLED", "CONVERTED"] }

async function computeDeletability(
  kind: "customer" | "supplier",
  id: string,
): Promise<CariDeletability> {
  const idField = kind === "customer" ? "customerId" : "supplierId"

  const entity =
    kind === "customer"
      ? await prisma.customer.findUnique({
          where: { id },
          select: { companyId: true, openingBalanceAmount: true, openingBalanceType: true },
        })
      : await prisma.supplier.findUnique({
          where: { id },
          select: { companyId: true, openingBalanceAmount: true, openingBalanceType: true },
        })

  const [invoices, incomeAgg, expenseAgg, invoiceCount, transactionCount, checkNoteCredit, virman, aging] =
    await Promise.all([
      prisma.invoice.findMany({
        where: { [idField]: id, status: POSTED_INVOICE_STATUS },
        select: {
          type: true,
          returnKind: true,
          totalAmount: true,
          payments: { select: { amount: true, transactionId: true } },
        },
      }),
      prisma.transaction.aggregate({
        where: { [idField]: id, type: "INCOME" },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { [idField]: id, type: "EXPENSE" },
        _sum: { amount: true },
      }),
      prisma.invoice.count({ where: { [idField]: id } }),
      prisma.transaction.count({ where: { [idField]: id } }),
      // Geçerli çek/senet (iade/protesto hariç).
      getCariCheckNoteCredit(kind, id),
      // Cari virman fişi (lib/cari/virman.ts): borç − alacak, ekstre ekseni.
      virmanNetForParty(kind, id),
      entity
        ? computeCariAging(entity.companyId, {
            ...(kind === "customer" ? { customerId: id } : { supplierId: id }),
            // Silme/arşiv sorusunda taslak da AÇIK belgedir.
            includeDrafts: true,
          })
        : null,
    ])

  // Açılış: müşteride DEBIT bakiyeyi artırır; tedarikçide aynalı — CREDIT
  // (biz ona borçluyuz) artırır (bkz. suppliers/[id]/route.ts).
  const openingMagnitude = Number(entity?.openingBalanceAmount || 0)
  const openingIsCredit = entity?.openingBalanceType === "CREDIT"
  const openingSigned =
    kind === "customer"
      ? openingIsCredit ? -openingMagnitude : openingMagnitude
      : openingIsCredit ? openingMagnitude : -openingMagnitude

  const incomeSum = Number(incomeAgg._sum.amount || 0)
  const expenseSum = Number(expenseAgg._sum.amount || 0)
  // Müşteride EXPENSE (ör. iade) bakiyeyi ARTIRIR / INCOME (tahsilat) AZALTIR.
  // Tedarikçide simetrik tersi: EXPENSE (ödeme) borcu AZALTIR / INCOME ARTIRIR.
  const transactionSigned =
    kind === "customer" ? expenseSum - incomeSum : incomeSum - expenseSum
  const virmanSigned = kind === "customer" ? virman.debitMinusCredit : -virman.debitMinusCredit

  const balance =
    invoiceBalanceEffect(kind, invoices) +
    transactionSigned +
    openingSigned -
    checkNoteCredit +
    virmanSigned

  const hasOpenBalance = Math.abs(balance) >= EPSILON

  // Açık fatura = yaşlandırmada hâlâ açık kalan BELGE kalemi. Açılış bakiyesi
  // ve virman kalemleri de yaşlandırmada durur ama fatura değildir (belge türü
  // yok); onlar yukarıdaki bakiye sorusunun konusudur.
  const account = aging
    ? (kind === "customer" ? aging.customers.accounts : aging.suppliers.accounts)[0]
    : undefined
  const invoiceOpenSum = (account?.invoices ?? [])
    .filter((item) => item.documentKind !== null)
    .reduce((sum, item) => sum + item.openAmount, 0)
  const hasOpenInvoices = invoiceOpenSum >= EPSILON

  // Virman bacağı olan cari SİLİNEMEZ (FK NO ACTION): silinseydi fişin karşı
  // tarafındaki bakiye karşılıksız kalırdı. Arşivlemeye yönlendirilir.
  const hasHistory = invoiceCount > 0 || transactionCount > 0 || virman.count > 0

  const archiveBlockReasons: string[] = []
  if (hasOpenBalance) archiveBlockReasons.push(REASON_OPEN_BALANCE)
  if (hasOpenInvoices) archiveBlockReasons.push(REASON_OPEN_INVOICES)

  const deleteBlockReasons: string[] = [...archiveBlockReasons]
  if (hasHistory) deleteBlockReasons.push(REASON_HISTORY)

  const canArchive = archiveBlockReasons.length === 0
  const canDelete = canArchive && !hasHistory

  return {
    hasOpenBalance,
    hasOpenInvoices,
    hasHistory,
    canDelete,
    canArchive,
    deleteBlockReasons,
    archiveBlockReasons,
  }
}

export function getCustomerDeletability(customerId: string) {
  return computeDeletability("customer", customerId)
}

export function getSupplierDeletability(supplierId: string) {
  return computeDeletability("supplier", supplierId)
}
