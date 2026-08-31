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
  /**
   * Cari kartındaki sınıflandırmalar (Ayarlar → Tanımlar). Rapor ve dosya bunları
   * ayrı sütunlarda gösterir; tanımsız cari için boş string gelir.
   */
  class1: string
  class2: string
  netAmount: number
  vatAmount: number
  totalAmount: number
}

/**
 * Faturanın SATIRI — "Detaylı Faturalar" sayfası için. Fatura kimliği her satırda
 * tekrarlanır ki Excel'de tek başına süzülebilsin/pivotlanabilsin.
 */
export type SalesPurchaseInvoiceLine = {
  invoiceId: string
  invoiceNo: string
  /** e-Belge numarası (GİB'e giden asıl numara); yoksa boş. */
  eDocumentNo: string
  date: string
  isReturn: boolean
  counterpartyName: string
  class1: string
  class2: string
  productCode: string
  /** Kalemin adı — ürün kartına bağlı değilse fatura satırındaki serbest metin. */
  description: string
  kind: "Stok" | "Hizmet" | "Serbest kalem"
  unit: string
  quantity: number
  unitPrice: number
  discountAmount: number
  vatRate: number
  vatAmount: number
  totalAmount: number
}

export type SalesPurchaseResult = {
  type: SalesPurchaseKind
  count: number
  totalAmount: number
  monthly: Array<{ label: string; sortKey: string; amount: number; count: number }>
  topCounterparties: Array<{ name: string; class1: string; class2: string; amount: number; count: number }>
  invoices: SalesPurchaseInvoice[]
  /** Yalnız `includeLines` istendiğinde dolar (dışa aktarma); ekran kullanmaz. */
  lines: SalesPurchaseInvoiceLine[]
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
  /**
   * Fatura kalemlerini de getir ("Detaylı Faturalar" sayfası). Ekran bunu
   * istemez: kalem sorgusu fatura sayısıyla büyür, özet ekranı yavaşlatır.
   */
  includeLines?: boolean
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
      customer: {
        select: {
          name: true,
          classification1: { select: { label: true } },
          classification2: { select: { label: true } },
        },
      },
      supplier: {
        select: {
          name: true,
          classification1: { select: { label: true } },
          classification2: { select: { label: true } },
        },
      },
      ...(args.includeLines
        ? {
            items: {
              orderBy: { order: "asc" as const },
              select: {
                description: true,
                unit: true,
                quantity: true,
                unitPrice: true,
                discountAmount: true,
                vatRate: true,
                vatAmount: true,
                totalAmount: true,
                product: { select: { code: true, isService: true } },
              },
            },
          }
        : {}),
    },
    orderBy: { date: "desc" },
  })

  const lines: SalesPurchaseInvoiceLine[] = []
  const monthlyMap = new Map<string, { label: string; sortKey: string; amount: number; count: number }>()
  const counterpartyMap = new Map<string, { class1: string; class2: string; amount: number; count: number }>()
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
    const party = isSales ? invoice.customer : invoice.supplier
    const name = party?.name?.trim() || (isSales ? "Perakende" : "Tanımsız")
    const class1 = party?.classification1?.label || ""
    const class2 = party?.classification2?.label || ""
    const counterparty = counterpartyMap.get(name) ?? { class1, class2, amount: 0, count: 0 }
    counterparty.amount += amount
    counterparty.count += 1
    counterpartyMap.set(name, counterparty)

    // İADE satırlarının tutarları da EKSİ yazılır: kalem sayfasının toplamı
    // fatura sayfasınınkiyle tutmalı.
    for (const item of (invoice as { items?: any[] }).items ?? []) {
      lines.push({
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        eDocumentNo: invoice.eDocumentNo || "",
        date: invoice.date.toISOString(),
        isReturn,
        counterpartyName: name,
        class1,
        class2,
        productCode: item.product?.code || "",
        description: item.description,
        kind: item.product ? (item.product.isService ? "Hizmet" : "Stok") : "Serbest kalem",
        unit: item.unit,
        quantity: sign * Number(item.quantity || 0),
        unitPrice: Number(item.unitPrice || 0),
        discountAmount: sign * Number(item.discountAmount || 0),
        vatRate: Number(item.vatRate || 0),
        vatAmount: sign * Number(item.vatAmount || 0),
        totalAmount: sign * Number(item.totalAmount || 0),
      })
    }

    return {
      id: invoice.id,
      invoiceNo: invoice.invoiceNo,
      date: invoice.date.toISOString(),
      status: invoice.status,
      isReturn,
      counterpartyName: name,
      class1,
      class2,
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
    lines,
  }
}
