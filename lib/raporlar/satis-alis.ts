/**
 * Satış / alış raporu hesabı — aylık kırılım, en çok işlem yapılan cariler,
 * son faturalar.
 *
 * `/raporlar/satis` ve `/raporlar/alis` ekranları bu özetleri tarayıcıda,
 * `/api/e-donusum/invoices`ten çektikleri TÜM fatura listesi üzerinden
 * hesaplıyor. Dışa aktarma da aynı sonucu vermek zorunda olduğu için mantık
 * buraya alındı; iki ekran tek gövdeyi paylaşıyor (tek fark `type`).
 *
 * DİKKAT — durum süzgeci bilerek YOK: ekranlar `type` dışında hiçbir filtre
 * uygulamıyor, yani iptal (CANCELLED) ve dönüştürülmüş (CONVERTED) faturalar da
 * toplama giriyor. Burada "düzeltmek" dosyayı ekrandan farklı kılardı; ekran
 * düzeltilirse bu fonksiyon da onunla birlikte düzeltilmeli.
 */

import { prisma } from "@/lib/db/prisma"
import {
  PURCHASE_RETURN_WHERE,
  SALES_RETURN_WHERE,
  payableSign,
  receivableSign,
} from "@/lib/cari/invoice-direction"

export type SalesPurchaseKind = "SALES" | "PURCHASE"

export type SalesPurchaseInvoice = {
  id: string
  invoiceNo: string
  date: string
  status: string
  /** İade belgesi mi — tutarları EKSİ gelir, listede öyle işaretlenmeli. */
  isReturn: boolean
  counterpartyName: string
  netAmount: number
  vatAmount: number
  totalAmount: number
}

export type SalesPurchaseResult = {
  type: SalesPurchaseKind
  count: number
  totalAmount: number
  monthly: Array<{ label: string; sortKey: string; amount: number; count: number }>
  topCounterparties: Array<{ name: string; amount: number; count: number }>
  invoices: SalesPurchaseInvoice[]
}

const monthLabel = (date: Date) =>
  date.toLocaleDateString("tr-TR", { month: "short", year: "2-digit" })

export async function computeSalesPurchaseReport(args: {
  companyId: string
  type: SalesPurchaseKind
  /** Ekranda karşılığı yok; dışa aktarmada dönem daraltmak için opsiyonel. */
  startDate?: string | null
  endDate?: string | null
  /** En çok işlem yapılan cari sayısı. */
  topCount?: number
}): Promise<SalesPurchaseResult> {
  const isSales = args.type === "SALES"
  const dateFilter =
    args.startDate || args.endDate
      ? {
          gte: args.startDate ? new Date(args.startDate) : undefined,
          lte: args.endDate ? new Date(args.endDate) : undefined,
        }
      : undefined

  // İADELER de çekilir ve tutarları EKSİ sayılır: net ciro/net alış budur.
  // Ayrı bir rapor yerine aynı listede negatif satır olması, "fatura toplamım
  // neden rapordan yüksek" sorusunu satır satır cevaplar.
  const returnWhere = isSales ? SALES_RETURN_WHERE() : PURCHASE_RETURN_WHERE()
  const invoices = await prisma.invoice.findMany({
    where: {
      companyId: args.companyId,
      OR: [{ type: args.type }, returnWhere],
      ...(dateFilter ? { date: dateFilter } : {}),
    },
    include: {
      customer: { select: { name: true } },
      supplier: { select: { name: true } },
    },
    orderBy: { date: "desc" },
  })

  const monthlyMap = new Map<string, { label: string; sortKey: string; amount: number; count: number }>()
  const counterpartyMap = new Map<string, { amount: number; count: number }>()
  let totalAmount = 0

  const rows: SalesPurchaseInvoice[] = invoices.map((invoice) => {
    const sign = isSales ? receivableSign(invoice) : payableSign(invoice)
    const isReturn = sign < 0
    const amount = sign * Number(invoice.totalAmount || 0)
    totalAmount += amount

    const date = new Date(invoice.date)
    const sortKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
    const month = monthlyMap.get(sortKey) ?? { label: monthLabel(date), sortKey, amount: 0, count: 0 }
    month.amount += amount
    month.count += 1
    monthlyMap.set(sortKey, month)

    // Carisiz satış = hızlı/perakende satış.
    const name =
      (isSales ? invoice.customer?.name : invoice.supplier?.name)?.trim() ||
      (isSales ? "Perakende" : "Tanımsız")
    const counterparty = counterpartyMap.get(name) ?? { amount: 0, count: 0 }
    counterparty.amount += amount
    counterparty.count += 1
    counterpartyMap.set(name, counterparty)

    return {
      id: invoice.id,
      invoiceNo: invoice.invoiceNo,
      date: invoice.date.toISOString(),
      status: invoice.status,
      isReturn,
      counterpartyName: name,
      netAmount: sign * Number(invoice.netAmount || 0),
      vatAmount: sign * Number(invoice.vatAmount || 0),
      totalAmount: amount,
    }
  })

  return {
    type: args.type,
    count: invoices.length,
    totalAmount,
    monthly: Array.from(monthlyMap.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey)),
    topCounterparties: Array.from(counterpartyMap.entries())
      .map(([name, value]) => ({ name, ...value }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, args.topCount ?? 20),
    invoices: rows,
  }
}
