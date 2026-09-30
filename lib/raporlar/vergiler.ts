/**
 * Vergi beyanname hazırlık raporları: KDV, Muhtasar, Ba-Bs.
 *
 * `app/api/raporlar/{kdv-beyanname,muhtasar,ba-bs}/route.ts`ten ayıklandı —
 * dışa aktarma ucu da aynı fonksiyonları çağırır.
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import {
  alisAilesiSql,
  kdvIsaretSql,
  kdvKurSql,
  kdvyeGirerSql,
  satisAilesiSql,
} from "@/lib/raporlar/kdv-kural"

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
    sales: Array<{ vatRate: number; vatAmount: number; totalAmount: number }>
    purchases: Array<{ vatRate: number; vatAmount: number; totalAmount: number }>
  }
  /** KDV'ye giren belge sayısı (iadeler dahil) — kart metinleri okur. */
  documentCounts: { sales: number; purchases: number }
  /**
   * Kuru girilmemiş dövizli belge: TL'ye çevrilemediği için toplama GİRMEDİ.
   * Sıfır değilse ekran bunu yazar — sessizce düşmez (bkz. kdv-kural.ts).
   */
  unconvertedForeign: number
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

  // Hangi belgenin KDV'ye girdiği ve dövizin TL'ye çevrimi TEK YERDE:
  // lib/raporlar/kdv-kural.ts. (İptal ve faturaya dönüşmüş fiş girmez —
  // CONVERTED fiş süzülmezse KDV'si hem fişte hem faturada sayılırdı; Reypo
  // Medya'da 6 fiş / 8.616 TL fazladan ölçülmüştü.)
  //
  // İADELER kendi ailesinin toplamını AZALTIR (satış iadesi hesaplananı, alış
  // iadesi indirilecek KDV'yi). Oran kırılımı ilgili tarafta netlenir ki satış
  // ve iade aynı satırda görünsün; iade oranı faturada yoksa eksi satır kalır.
  const where = Prisma.sql`
    i."companyId" = ${args.companyId}
    AND i.date >= ${startDate} AND i.date <= ${endDate}
    AND ${kdvyeGirerSql("i")}
  `
  const [rateRows, countRows] = await Promise.all([
    prisma.$queryRaw<Array<{ aile: string; vatRate: unknown; vat: unknown; total: unknown }>>(Prisma.sql`
      SELECT CASE WHEN ${satisAilesiSql("i")} THEN 'S' ELSE 'P' END AS aile,
             ii."vatRate" AS "vatRate",
             COALESCE(SUM(${kdvIsaretSql("i")} * ii."vatAmount" * ${kdvKurSql("i")}), 0) AS vat,
             COALESCE(SUM(${kdvIsaretSql("i")} * ii."totalAmount" * ${kdvKurSql("i")}), 0) AS total
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii."invoiceId"
      WHERE ${where} AND ${kdvKurSql("i")} IS NOT NULL
      GROUP BY 1, 2
      ORDER BY 2
    `),
    prisma.$queryRaw<Array<{ satis: bigint; alis: bigint; kursuz: bigint }>>(Prisma.sql`
      SELECT COUNT(*) FILTER (WHERE ${satisAilesiSql("i")} AND ${kdvKurSql("i")} IS NOT NULL) AS satis,
             COUNT(*) FILTER (WHERE ${alisAilesiSql("i")} AND ${kdvKurSql("i")} IS NOT NULL) AS alis,
             COUNT(*) FILTER (WHERE ${kdvKurSql("i")} IS NULL) AS kursuz
      FROM invoices i
      WHERE ${where}
    `),
  ])

  type RateRow = { vatRate: number; vatAmount: number; totalAmount: number }
  // Kuruş: TL karşılığı çarpımı kuruş altı basamak üretebilir; oran satırı
  // ekranda ve Excel'de toplanacağı için satır kuruşa yuvarlanır.
  const kurus = (n: unknown) => Math.round(Number(n ?? 0) * 100) / 100
  const toRows = (aile: string): RateRow[] =>
    rateRows
      .filter((r) => r.aile === aile)
      .map((r) => ({ vatRate: Number(r.vatRate), vatAmount: kurus(r.vat), totalAmount: kurus(r.total) }))
      .sort((a, b) => a.vatRate - b.vatRate)

  const sales = toRows("S")
  const purchases = toRows("P")
  const calculatedVAT = kurus(sales.reduce((sum, item) => sum + item.vatAmount, 0))
  const deductibleVAT = kurus(purchases.reduce((sum, item) => sum + item.vatAmount, 0))
  const counts = countRows[0]

  return {
    period,
    year: args.year,
    month: period === "monthly" ? args.month : undefined,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    calculatedVAT,
    deductibleVAT,
    netVAT: kurus(calculatedVAT - deductibleVAT),
    breakdown: { sales, purchases },
    documentCounts: { sales: Number(counts?.satis ?? 0), purchases: Number(counts?.alis ?? 0) },
    unconvertedForeign: Number(counts?.kursuz ?? 0),
  }
}

export type WithholdingResult = {
  period: { year: number; month: number; startDate: string; endDate: string }
  payments: Array<{
    id: string
    date: string
    amount: number
    description: string | null
    /** `ref`: tedarikçi kartının adresi (slug ya da id) — ekran adı karta bağlar. */
    supplier: { ref: string; name: string; taxNumber: string | null } | null
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
      supplier: p.supplier
        ? {
            ref: p.supplier.slug || p.supplier.id,
            name: p.supplier.name,
            taxNumber: p.supplier.taxNumber,
          }
        : null,
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
