/**
 * Cari yaşlandırma hesabı.
 *
 * `app/api/raporlar/cari-yaslandirma/route.ts`ten ayıklandı: dışa aktarma ile
 * ekranın aynı vade/gecikme/performans sayılarını üretmesi için tek kaynak.
 */

import { prisma } from "@/lib/db/prisma"
import { getCheckNoteCreditMap } from "@/lib/cari/check-credit"

const DAY_MS = 24 * 60 * 60 * 1000

export type AgingTotals = {
  not_due: number
  overdue: number
  overdueAvgDays: number
  performanceAvgDays: number
  performanceScore: number
  performanceLabel: string
  total: number
}

export type AgingInvoice = {
  id: string
  invoiceNo: string
  date: Date
  effectiveDueDate: Date
  totalAmount: number
  paidAmount: number
  openAmount: number
  lastPaymentDate: Date | null
  overdueDays: number
  bucket: "not_due" | "overdue"
  performanceDays: number
}

export type AgingAccount = {
  id: string
  name: string
  code: string | null
  paymentDueDays: number | null
  taxNumber: string | null
  totals: AgingTotals
  invoices: AgingInvoice[]
}

function emptyTotals(): AgingTotals {
  return {
    not_due: 0,
    overdue: 0,
    overdueAvgDays: 0,
    performanceAvgDays: 0,
    performanceScore: 0,
    performanceLabel: "Veri yok",
    total: 0,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function round2(value: number) {
  return Number(value.toFixed(2))
}

function resolveEffectiveDueMs(invoice: any, paymentDueDays: number | null) {
  const baseDate = new Date(invoice.date).getTime()
  const explicitDue = invoice.dueDate ? new Date(invoice.dueDate).getTime() : null
  if (explicitDue !== null) return explicitDue
  if (typeof paymentDueDays === "number" && paymentDueDays > 0) {
    return baseDate + paymentDueDays * DAY_MS
  }
  return baseDate
}

function computePerformanceScore(avgDays: number) {
  // Erken ödemeyi pozitif, gecikmeyi negatif etkileyen sade bir ölçek.
  if (!Number.isFinite(avgDays)) {
    return { score: 0, label: "Veri yok" }
  }
  const rawScore = avgDays <= 0 ? 100 + Math.abs(avgDays) * 0.8 : 100 - avgDays * 2
  const score = Math.round(clamp(rawScore, 0, 100))
  let label = "Zamanında"
  if (avgDays <= -3) label = "Erken ödeyen"
  else if (avgDays >= 15) label = "Riskli"
  else if (avgDays >= 4) label = "Gecikmeli"
  return { score, label }
}

function bucketize(invoice: any, paymentDueDays: number | null, today: number): AgingInvoice | null {
  const total = Number(invoice.totalAmount)
  if (total <= 0) return null
  const payments = (invoice.payments || []).map((p: any) => ({
    amount: Number(p.amount),
    paymentDate: p.paymentDate ? new Date(p.paymentDate) : null,
  }))
  const paid = payments.reduce((s: number, p: any) => s + Number(p.amount), 0)
  const open = round2(total - paid)

  const effectiveDueMs = resolveEffectiveDueMs(invoice, paymentDueDays)
  const overdueDays = Math.floor((today - effectiveDueMs) / DAY_MS)
  const sortedByDate = payments
    .filter((p: any) => p.paymentDate)
    .sort((a: any, b: any) => a.paymentDate.getTime() - b.paymentDate.getTime())
  const lastPaymentDate = sortedByDate.length > 0 ? sortedByDate[sortedByDate.length - 1].paymentDate : null
  const performanceRefMs = (lastPaymentDate ?? new Date(today)).getTime()
  const performanceDays = Math.floor((performanceRefMs - effectiveDueMs) / DAY_MS)
  const bucket: AgingInvoice["bucket"] = overdueDays > 0 ? "overdue" : "not_due"

  return {
    id: invoice.id,
    invoiceNo: invoice.invoiceNo,
    date: invoice.date,
    effectiveDueDate: new Date(effectiveDueMs),
    totalAmount: total,
    paidAmount: paid,
    openAmount: open,
    lastPaymentDate,
    overdueDays: Math.max(0, overdueDays),
    bucket,
    performanceDays,
  }
}

function openingBalanceToAgingItem(
  account: {
    id: string
    createdAt: Date
    openingBalanceAmount: unknown
    openingBalanceType: string | null
    paymentDueDays: number | null
  },
  today: number
): AgingInvoice | null {
  const openingAmount = Number(account.openingBalanceAmount || 0)
  if (!Number.isFinite(openingAmount) || openingAmount <= 0) return null
  // Current balance conventions treat DEBIT as positive receivable/payable exposure.
  if (String(account.openingBalanceType || "DEBIT").toUpperCase() !== "DEBIT") return null

  const baseDate = new Date(account.createdAt)
  const dueMs =
    typeof account.paymentDueDays === "number" && account.paymentDueDays > 0
      ? baseDate.getTime() + account.paymentDueDays * DAY_MS
      : baseDate.getTime()
  const overdueDays = Math.floor((today - dueMs) / DAY_MS)
  const performanceDays = Math.floor((today - dueMs) / DAY_MS)
  const amount = round2(openingAmount)

  return {
    id: `opening-${account.id}`,
    invoiceNo: "Açılış Bakiyesi",
    date: baseDate,
    effectiveDueDate: new Date(dueMs),
    totalAmount: amount,
    paidAmount: 0,
    openAmount: amount,
    lastPaymentDate: null,
    overdueDays: Math.max(0, overdueDays),
    bucket: overdueDays > 0 ? "overdue" : "not_due",
    performanceDays,
  }
}

/**
 * Faturaya bağlanmamış serbest tahsilat/ödeme havuzunu (ör. cari ekranındaki
 * "Tahsilat Ekle" ile girilen INCOME işlemi) açık fatura kalemlerine eskiden
 * yeniye (FIFO) uygular. Böylece hesap bakiyesi kapanmışsa yaşlandırma da açık
 * göstermez. Havuz tutarı pozitif değilse bir şey yapmaz.
 */
function applyUnallocatedCredits(items: AgingInvoice[], pool: number) {
  if (!(pool > 0)) return
  let remaining = pool
  // Vadesi en eski kalemden başlayarak kapat.
  const ordered = [...items].sort(
    (a, b) => a.effectiveDueDate.getTime() - b.effectiveDueDate.getTime(),
  )
  for (const item of ordered) {
    if (remaining <= 0) break
    if (item.openAmount <= 0) continue
    const applied = Math.min(item.openAmount, remaining)
    item.openAmount = round2(item.openAmount - applied)
    remaining = round2(remaining - applied)
    if (item.openAmount <= 0) {
      // Tamamen tahsil edildi: artık açık/gecikmiş değil.
      item.openAmount = 0
      item.overdueDays = 0
      item.bucket = "not_due"
    }
  }
}

function summarize(invoices: AgingInvoice[]): AgingTotals {
  const totals = emptyTotals()
  let overdueWeightedDays = 0
  let overdueWeight = 0
  let perfWeightedDays = 0
  let perfWeight = 0

  for (const inv of invoices) {
    totals[inv.bucket] += inv.openAmount
    totals.total += inv.openAmount

    if (inv.bucket === "overdue") {
      overdueWeightedDays += inv.overdueDays * inv.openAmount
      overdueWeight += inv.openAmount
    }

    // Karma performans: kapanan kısım + açık kısım birlikte.
    if (inv.paidAmount > 0) {
      perfWeightedDays += inv.performanceDays * inv.paidAmount
      perfWeight += inv.paidAmount
    }
    if (inv.openAmount > 0) {
      perfWeightedDays += inv.performanceDays * inv.openAmount
      perfWeight += inv.openAmount
    }
  }
  totals.overdueAvgDays = overdueWeight > 0 ? round2(overdueWeightedDays / overdueWeight) : 0
  totals.performanceAvgDays = perfWeight > 0 ? round2(perfWeightedDays / perfWeight) : 0
  const perf = computePerformanceScore(totals.performanceAvgDays)
  totals.performanceScore = perf.score
  totals.performanceLabel = perf.label
  return totals
}

export type CariAgingResult = {
  asOf: string
  customers: { accounts: AgingAccount[]; totals: AgingTotals }
  suppliers: { accounts: AgingAccount[]; totals: AgingTotals }
}

export async function computeCariAging(companyId: string): Promise<CariAgingResult> {
  const today = Date.now()

  const customers = await prisma.customer.findMany({
    where: { companyId },
    select: {
      id: true,
      name: true,
      code: true,
      paymentDueDays: true,
      taxNumber: true,
      openingBalanceAmount: true,
      openingBalanceType: true,
      createdAt: true,
      invoices: {
        where: { type: "SALES", status: { notIn: ["CANCELLED", "CONVERTED"] } },
        select: {
          id: true,
          invoiceNo: true,
          date: true,
          dueDate: true,
          totalAmount: true,
          payments: { select: { amount: true, paymentDate: true, transactionId: true } },
        },
      },
      // Faturaya bağlanmamış serbest tahsilat/ödeme işlemleri (Tahsilat Ekle →
      // INCOME). Açık faturaları kapatmak için kullanılır.
      transactions: { select: { type: true, amount: true } },
    },
    orderBy: { name: "asc" },
  })

  const suppliers = await prisma.supplier.findMany({
    where: { companyId },
    select: {
      id: true,
      name: true,
      code: true,
      paymentDueDays: true,
      taxNumber: true,
      openingBalanceAmount: true,
      openingBalanceType: true,
      createdAt: true,
      invoices: {
        where: { type: "PURCHASE", status: { notIn: ["CANCELLED", "CONVERTED"] } },
        select: {
          id: true,
          invoiceNo: true,
          date: true,
          dueDate: true,
          totalAmount: true,
          payments: { select: { amount: true, paymentDate: true, transactionId: true } },
        },
      },
      // Faturaya bağlanmamış serbest ödeme işlemleri (Ödeme Ekle → EXPENSE).
      transactions: { select: { type: true, amount: true } },
    },
    orderBy: { name: "asc" },
  })

  // Çek/senet kredileri (iade/protesto hariç): cariId→tutar. Serbest tahsilat gibi
  // açık faturaları FIFO kapatır.
  const [customerCheckCredit, supplierCheckCredit] = await Promise.all([
    getCheckNoteCreditMap("customer", companyId),
    getCheckNoteCreditMap("supplier", companyId),
  ])

  const customerAccounts: AgingAccount[] = customers
    .map((c) => {
      const analyzed = c.invoices
        .map((inv) => bucketize(inv, c.paymentDueDays, today))
        .filter((x): x is AgingInvoice => Boolean(x))
      const openingItem = openingBalanceToAgingItem(c, today)
      if (openingItem) analyzed.push(openingItem)
      // Müşteride INCOME tahsilatları alacağı azaltır, EXPENSE artırır.
      const incomeSum = c.transactions
        .filter((t) => t.type === "INCOME")
        .reduce((s, t) => s + Number(t.amount), 0)
      const expenseSum = c.transactions
        .filter((t) => t.type === "EXPENSE")
        .reduce((s, t) => s + Number(t.amount), 0)
      // İşleme bağlı ödemeler zaten faturadan düşüldü; havuzdan da çıkar.
      const linkedSum = c.invoices.reduce(
        (s, inv) =>
          s + inv.payments.reduce((a, p) => a + (p.transactionId ? Number(p.amount) : 0), 0),
        0,
      )
      // Çek/senet (müşteriden alınan) alacağı kapatır → serbest krediye eklenir.
      const checkCredit = customerCheckCredit.get(c.id) || 0
      applyUnallocatedCredits(analyzed, round2(incomeSum - expenseSum - linkedSum + checkCredit))
      const invoices = analyzed.filter((inv) => inv.openAmount > 0)
      return {
        id: c.id,
        name: c.name,
        code: c.code,
        paymentDueDays: c.paymentDueDays,
        taxNumber: c.taxNumber,
        totals: summarize(analyzed),
        invoices,
      }
    })
    .filter((acc) => acc.totals.total > 0)

  const supplierAccounts: AgingAccount[] = suppliers
    .map((s) => {
      const analyzed = s.invoices
        .map((inv) => bucketize(inv, s.paymentDueDays, today))
        .filter((x): x is AgingInvoice => Boolean(x))
      const openingItem = openingBalanceToAgingItem(s, today)
      if (openingItem) analyzed.push(openingItem)
      // Tedarikçide EXPENSE ödemeleri borcu azaltır, INCOME artırır.
      const incomeSum = s.transactions
        .filter((t) => t.type === "INCOME")
        .reduce((sum, t) => sum + Number(t.amount), 0)
      const expenseSum = s.transactions
        .filter((t) => t.type === "EXPENSE")
        .reduce((sum, t) => sum + Number(t.amount), 0)
      // İşleme bağlı ödemeler zaten faturadan düşüldü; havuzdan da çıkar.
      const linkedSum = s.invoices.reduce(
        (sum, inv) =>
          sum + inv.payments.reduce((a, p) => a + (p.transactionId ? Number(p.amount) : 0), 0),
        0,
      )
      // Çek/senet (tedarikçiye verilen) borcu kapatır → serbest krediye eklenir.
      const checkCredit = supplierCheckCredit.get(s.id) || 0
      applyUnallocatedCredits(analyzed, round2(expenseSum - incomeSum - linkedSum + checkCredit))
      const invoices = analyzed.filter((inv) => inv.openAmount > 0)
      return {
        id: s.id,
        name: s.name,
        code: s.code,
        paymentDueDays: s.paymentDueDays,
        taxNumber: s.taxNumber,
        totals: summarize(analyzed),
        invoices,
      }
    })
    .filter((acc) => acc.totals.total > 0)

  const grandTotal = (accounts: AgingAccount[]): AgingTotals => {
    const t = emptyTotals()
    let overdueWeightedDays = 0
    let overdueWeight = 0
    let perfWeightedDays = 0
    let perfWeight = 0

    for (const a of accounts) {
      t.not_due += a.totals.not_due
      t.overdue += a.totals.overdue
      t.total += a.totals.total
      overdueWeightedDays += a.totals.overdueAvgDays * a.totals.overdue
      overdueWeight += a.totals.overdue
      perfWeightedDays += a.totals.performanceAvgDays * a.totals.total
      perfWeight += a.totals.total
    }
    t.overdueAvgDays = overdueWeight > 0 ? round2(overdueWeightedDays / overdueWeight) : 0
    t.performanceAvgDays = perfWeight > 0 ? round2(perfWeightedDays / perfWeight) : 0
    const perf = computePerformanceScore(t.performanceAvgDays)
    t.performanceScore = perf.score
    t.performanceLabel = perf.label
    return t
  }

  return {
    asOf: new Date().toISOString(),
    customers: {
      accounts: customerAccounts,
      totals: grandTotal(customerAccounts),
    },
    suppliers: {
      accounts: supplierAccounts,
      totals: grandTotal(supplierAccounts),
    },
  }
}
