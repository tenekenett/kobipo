import { prisma } from "@/lib/db/prisma"

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
  "Hesaba ait geçmiş faturalar veya ödeme/tahsilat kayıtları var."

const EPSILON = 0.01

async function computeDeletability(
  kind: "customer" | "supplier",
  id: string,
): Promise<CariDeletability> {
  const invoiceType = kind === "customer" ? "SALES" : "PURCHASE"
  const idField = kind === "customer" ? "customerId" : "supplierId"

  const entity =
    kind === "customer"
      ? await prisma.customer.findUnique({
          where: { id },
          select: { openingBalanceAmount: true, openingBalanceType: true },
        })
      : await prisma.supplier.findUnique({
          where: { id },
          select: { openingBalanceAmount: true, openingBalanceType: true },
        })

  const [
    invoiceAgg,
    paymentAgg,
    linkedPaymentAgg,
    incomeAgg,
    expenseAgg,
    invoiceCount,
    transactionCount,
    openInvoices,
  ] = await Promise.all([
    prisma.invoice.aggregate({
      where: { [idField]: id, type: invoiceType },
      _sum: { totalAmount: true },
    }),
    // Bakiye için: işleme bağlı OLMAYAN ödemeler (bağlı olanlar zaten Transaction
    // üzerinden bakiyeye yansıyor → çift sayım önlenir).
    prisma.invoicePayment.aggregate({
      where: { transactionId: null, invoice: { [idField]: id, type: invoiceType } },
      _sum: { amount: true },
    }),
    // İşleme bağlı ödemelerin toplamı: serbest tahsilat havuzundan düşülecek.
    prisma.invoicePayment.aggregate({
      where: { transactionId: { not: null }, invoice: { [idField]: id, type: invoiceType } },
      _sum: { amount: true },
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
    prisma.invoice.findMany({
      where: { [idField]: id, type: invoiceType, status: { not: "CANCELLED" } },
      select: { totalAmount: true, payments: { select: { amount: true } } },
    }),
  ])

  const openingSigned =
    entity?.openingBalanceType === "CREDIT"
      ? -Number(entity?.openingBalanceAmount || 0)
      : Number(entity?.openingBalanceAmount || 0)

  const incomeSum = Number(incomeAgg._sum.amount || 0)
  const expenseSum = Number(expenseAgg._sum.amount || 0)

  // Müşteride EXPENSE (ör. iade) bakiyeyi ARTIRIR / INCOME (tahsilat) AZALTIR.
  // Tedarikçide simetrik tersi: EXPENSE (ödeme) borcu AZALTIR / INCOME ARTIRIR.
  // (Eskiden her iki cari için müşteri işareti kullanılıyordu; tedarikçide ödeme
  // bakiyeyi yanlışça artırıyordu — bkz. collectionPool zaten doğru terslemişti.)
  const transactionSigned =
    kind === "customer" ? expenseSum - incomeSum : incomeSum - expenseSum

  const balance =
    Number(invoiceAgg._sum.totalAmount || 0) -
    Number(paymentAgg._sum.amount || 0) +
    transactionSigned +
    openingSigned

  const hasOpenBalance = Math.abs(balance) >= EPSILON
  // Açık fatura: faturaya bağlı ödemeler (InvoicePayment) DIŞINDA, cari ekranından
  // girilen serbest tahsilat/ödeme işlemleri (INCOME/EXPENSE) de açık faturaları
  // kapatabilir. Yaşlandırma raporu ve görünen bakiye ile tutarlı olmak için bu
  // serbest tahsilatları da düşüyoruz; aksi halde bakiyesi 0 olan hesap "açık
  // faturası var" diye yanlışça engellenir.
  const invoiceOpenSum = openInvoices.reduce((sum, inv) => {
    const paid = inv.payments.reduce((s, p) => s + Number(p.amount), 0)
    return sum + Math.max(0, Number(inv.totalAmount) - paid)
  }, 0)
  // Serbest (faturaya bağlanmamış) tahsilat havuzu. İşleme bağlı ödemeler hem
  // invoiceOpenSum'dan düşüldüğü için havuzdan da çıkarılır (çift düşmeyi önler).
  const linkedPaymentSum = Number(linkedPaymentAgg._sum.amount || 0)
  const collectionPool =
    (kind === "customer" ? incomeSum - expenseSum : expenseSum - incomeSum) - linkedPaymentSum
  const hasOpenInvoices = invoiceOpenSum - Math.max(0, collectionPool) >= EPSILON
  const hasHistory = invoiceCount > 0 || transactionCount > 0

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
