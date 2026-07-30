/**
 * Vergi beyanname hazırlık raporları: KDV, Muhtasar, Ba-Bs.
 *
 * `app/api/raporlar/{kdv-beyanname,muhtasar,ba-bs}/route.ts`ten ayıklandı —
 * dışa aktarma ucu da aynı fonksiyonları çağırır.
 */

import { prisma } from "@/lib/db/prisma"

/** Muhtasar stopaj oranı — basit yaklaşım, gerçek hesap daha karmaşık. */
const WITHHOLDING_RATE = 0.15

export type VatPeriod = "monthly" | "quarterly" | "yearly"

export type VatDeclarationResult = {
  period: VatPeriod
  year: number
  month?: number
  startDate: string
  endDate: string
  calculatedVAT: number
  deductibleVAT: number
  netVAT: number
  breakdown: {
    sales: Array<{ vatRate: any; vatAmount: number; totalAmount: number }>
    purchases: Array<{ vatRate: any; vatAmount: number; totalAmount: number }>
  }
}

export function resolveVatRange(period: VatPeriod, year: number, month: number) {
  if (period === "monthly") {
    return {
      startDate: new Date(year, month - 1, 1),
      endDate: new Date(year, month, 0, 23, 59, 59),
    }
  }
  if (period === "quarterly") {
    const quarter = month // 1, 2, 3, 4
    return {
      startDate: new Date(year, (quarter - 1) * 3, 1),
      endDate: new Date(year, quarter * 3, 0, 23, 59, 59),
    }
  }
  return {
    startDate: new Date(year, 0, 1),
    endDate: new Date(year, 11, 31, 23, 59, 59),
  }
}

export async function computeVatDeclaration(args: {
  companyId: string
  period?: VatPeriod
  year: number
  month: number
}): Promise<VatDeclarationResult> {
  const period = args.period ?? "monthly"
  const { startDate, endDate } = resolveVatRange(period, args.year, args.month)

  const [salesVAT, purchaseVAT] = await Promise.all([
    // Satış faturalarından KDV (Hesaplanan KDV)
    prisma.invoiceItem.groupBy({
      by: ["vatRate"],
      where: {
        invoice: {
          companyId: args.companyId,
          type: "SALES",
          status: { not: "CANCELLED" },
          date: { gte: startDate, lte: endDate },
        },
      },
      _sum: { vatAmount: true, totalAmount: true },
    }),
    // Alış faturalarından KDV (İndirilecek KDV)
    prisma.invoiceItem.groupBy({
      by: ["vatRate"],
      where: {
        invoice: {
          companyId: args.companyId,
          type: "PURCHASE",
          status: { not: "CANCELLED" },
          date: { gte: startDate, lte: endDate },
        },
      },
      _sum: { vatAmount: true, totalAmount: true },
    }),
  ])

  const calculatedVAT = salesVAT.reduce((sum, item) => sum + Number(item._sum.vatAmount || 0), 0)
  const deductibleVAT = purchaseVAT.reduce((sum, item) => sum + Number(item._sum.vatAmount || 0), 0)

  return {
    period,
    year: args.year,
    month: period === "monthly" ? args.month : undefined,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    calculatedVAT,
    deductibleVAT,
    netVAT: calculatedVAT - deductibleVAT,
    breakdown: {
      sales: salesVAT.map((item) => ({
        vatRate: item.vatRate,
        vatAmount: Number(item._sum.vatAmount || 0),
        totalAmount: Number(item._sum.totalAmount || 0),
      })),
      purchases: purchaseVAT.map((item) => ({
        vatRate: item.vatRate,
        vatAmount: Number(item._sum.vatAmount || 0),
        totalAmount: Number(item._sum.totalAmount || 0),
      })),
    },
  }
}

export type WithholdingResult = {
  period: { year: number; month: number; startDate: string; endDate: string }
  payments: Array<{
    id: string
    date: string
    amount: number
    description: string | null
    supplier: { name: string; taxNumber: string | null } | null
  }>
  totalWithholding: number
  totalPayments: number
}

export async function computeWithholding(args: {
  companyId: string
  year: number
  month: number
}): Promise<WithholdingResult> {
  const startDate = new Date(args.year, args.month - 1, 1)
  const endDate = new Date(args.year, args.month, 0, 23, 59, 59)

  // Muhtasar beyanname için ödemeler (maaş, hizmet alımları vb.)
  // Şimdilik sadece temel yapı, daha sonra detaylandırılabilir.
  const payments = await prisma.transaction.findMany({
    where: {
      companyId: args.companyId,
      type: "EXPENSE",
      date: { gte: startDate, lte: endDate },
      description: { contains: "maaş" },
    },
    include: { supplier: true },
  })

  return {
    period: {
      year: args.year,
      month: args.month,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    },
    payments: payments.map((p) => ({
      id: p.id,
      date: p.date.toISOString(),
      amount: Number(p.amount),
      description: p.description,
      supplier: p.supplier ? { name: p.supplier.name, taxNumber: p.supplier.taxNumber } : null,
    })),
    // Basit örnek: %15 stopaj (gerçek hesaplama daha karmaşık).
    totalWithholding: payments.reduce((sum, p) => sum + Number(p.amount) * WITHHOLDING_RATE, 0),
    totalPayments: payments.reduce((sum, p) => sum + Number(p.amount), 0),
  }
}

export type BaBsInvoice = {
  invoiceNo: string
  date: string
  counterparty: { name: string; taxNumber: string | null } | null
  netAmount: number
  vatAmount: number
  totalAmount: number
}

export type BaBsResult = {
  period: { year: number; month: number; startDate: string; endDate: string }
  sales: {
    count: number
    netAmount: number
    vatAmount: number
    totalAmount: number
    invoices: BaBsInvoice[]
  }
  purchases: {
    count: number
    netAmount: number
    vatAmount: number
    totalAmount: number
    invoices: BaBsInvoice[]
  }
}

export async function computeBaBs(args: {
  companyId: string
  year: number
  month: number
}): Promise<BaBsResult> {
  const startDate = new Date(args.year, args.month - 1, 1)
  const endDate = new Date(args.year, args.month, 0, 23, 59, 59)

  const [salesInvoices, purchaseInvoices] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        companyId: args.companyId,
        type: "SALES",
        isReceipt: false, // Ba/Bs yalnızca resmî faturalar; fişler dâhil değil
        status: { not: "CANCELLED" },
        date: { gte: startDate, lte: endDate },
      },
      include: { customer: true },
      orderBy: { date: "asc" },
    }),
    prisma.invoice.findMany({
      where: {
        companyId: args.companyId,
        type: "PURCHASE",
        isReceipt: false, // Ba/Bs yalnızca resmî faturalar; fişler dâhil değil
        status: { not: "CANCELLED" },
        date: { gte: startDate, lte: endDate },
      },
      include: { supplier: true },
      orderBy: { date: "asc" },
    }),
  ])

  // Satış ve alış kayıtları farklı ilişki taşıyor (customer / supplier); yardımcı
  // yalnızca tutar alanlarına bakar.
  const sum = (
    rows: Array<Record<"netAmount" | "vatAmount" | "totalAmount", unknown>>,
    key: "netAmount" | "vatAmount" | "totalAmount",
  ) => rows.reduce((total, row) => total + Number(row[key] || 0), 0)

  return {
    period: {
      year: args.year,
      month: args.month,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    },
    sales: {
      count: salesInvoices.length,
      netAmount: sum(salesInvoices, "netAmount"),
      vatAmount: sum(salesInvoices, "vatAmount"),
      totalAmount: sum(salesInvoices, "totalAmount"),
      invoices: salesInvoices.map((inv) => ({
        invoiceNo: inv.invoiceNo,
        date: inv.date.toISOString(),
        counterparty: inv.customer
          ? { name: inv.customer.name, taxNumber: inv.customer.taxNumber }
          : null,
        netAmount: Number(inv.netAmount),
        vatAmount: Number(inv.vatAmount),
        totalAmount: Number(inv.totalAmount),
      })),
    },
    purchases: {
      count: purchaseInvoices.length,
      netAmount: sum(purchaseInvoices, "netAmount"),
      vatAmount: sum(purchaseInvoices, "vatAmount"),
      totalAmount: sum(purchaseInvoices, "totalAmount"),
      invoices: purchaseInvoices.map((inv) => ({
        invoiceNo: inv.invoiceNo,
        date: inv.date.toISOString(),
        counterparty: inv.supplier
          ? { name: inv.supplier.name, taxNumber: inv.supplier.taxNumber }
          : null,
        netAmount: Number(inv.netAmount),
        vatAmount: Number(inv.vatAmount),
        totalAmount: Number(inv.totalAmount),
      })),
    },
  }
}
