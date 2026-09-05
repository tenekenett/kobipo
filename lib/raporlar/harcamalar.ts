/**
 * HARCAMALAR RAPORU — giderin tamamı, kategori ağacı ve kalem kalem dökümü.
 *
 * Paraşüt'ün "Giderler Raporu" + "Giderlere Hızlı Bakış"ının karşılığı.
 *
 * GELİR-GİDER RAPORUNDAN FARKI NE: orası kârlılığı ölçer (gelir ve gider yan
 * yana, düz kategori listesi); burası yalnız GİDER tarafına bakar ve iki şey
 * ekler — kategori ağacı ("Personel > Maaş" ile "Personel > SGK" tek başlıkta
 * toplanır) ve HARCAMA DEFTERİ (her satır bir belge/fiş, süzülebilir). İkisi
 * aynı kaynaktan aynı ölçüyle beslenir: `netAmount`, alış iadesi eksi, faturaya
 * bağlı ödeme çift sayılmaz, virman bacağı gider değildir. Ayrışırlarsa
 * kullanıcı hangisine güveneceğini bilemez.
 *
 * ÖLÇÜ NET TUTARDIR (KDV hariç): indirilecek KDV firmanın gideri değildir.
 */

import { prisma } from "@/lib/db/prisma"
import { isPurchaseReturn } from "@/lib/cari/invoice-direction"
import { NOT_TRANSFER_WHERE } from "@/lib/finans/nakit-hareket"
import { periodWhere, resolvePeriodBounds } from "./date-range"
import {
  buildBreakdowns,
  type BreakdownRow,
  type ClassifiedEntry,
} from "./gelir-gider-kirilim"
import {
  buildExpenseTree,
  splitCategory,
  type ExpenseTree,
  type ExpenseTreeEntry,
} from "./harcamalar-kirilim"

/** Ekranda basılan kalem sayısı tavanı. Dışa aktarma bu sınırı UYGULAMAZ. */
export const EXPENSE_ROW_LIMIT = 500

export type ExpenseRow = {
  id: string
  /** `invoice` = alış faturası/fişi, `transaction` = faturasız kasa hareketi. */
  kind: "invoice" | "transaction"
  date: string
  /** Fatura numarası ya da işlemin açıklaması. */
  label: string
  /** Belge sayfasının adresi (slug ya da id); faturasız harekette null. */
  documentRef: string | null
  isReceipt: boolean
  /** Alış iadesi mi — tutar EKSİ basılır. */
  isReturn: boolean
  supplierName: string | null
  supplierRef: string | null
  category: string | null
  tags: string[]
  amount: number
}

export type ExpenseReportResult = {
  period: { startDate: string; endDate: string }
  totals: {
    /** Dönem toplam gideri (net, iadeler düşülmüş). */
    total: number
    /** Fatura kaynaklı kısım. */
    invoiced: number
    /** Faturasız kasa hareketlerinden gelen kısım. */
    uninvoiced: number
    /** Kaç kalem. */
    count: number
    /** Ay başına ortalama — dönem uzunluğuna göre. */
    monthlyAverage: number
  }
  /** Aynı uzunluktaki önceki dönemin toplam gideri; karşılaştırma için. */
  previousTotal: number
  tree: ExpenseTree
  byTag: BreakdownRow[]
  bySupplier: BreakdownRow[]
  byMonth: BreakdownRow[]
  rows: ExpenseRow[]
  /** Kalem listesi tavana takıldı mı — ekran "tamamı dosyada" der. */
  truncated: boolean
  /** Kategorisi girilmemiş kalem sayısı; "kırılım eksik" uyarısı buradan çıkar. */
  uncategorizedCount: number
  /** Dönemde kullanılmış ANA kategoriler — süzgeç listesi. */
  categories: string[]
}

const POSTED_STATUSES = ["CANCELLED", "CONVERTED"]

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Dönemin kaç ay sürdüğü — ortalama için. En az 1 (bölme yok). */
function monthSpan(start: Date, endExclusive: Date): number {
  const months =
    (endExclusive.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (endExclusive.getUTCMonth() - start.getUTCMonth())
  return Math.max(months, 1)
}

type UninvoicedRow = {
  id: string
  date: Date
  description: string | null
  category: string | null
  tags: string[]
  amount: unknown
}

export async function computeExpenseReport(args: {
  companyId: string
  startDate?: string | null
  endDate?: string | null
  /** ANA kategoriye göre süz (ağaçtaki üst satır). Boş = tümü. */
  category?: string | null
  /** Kalem listesi tavanı; dışa aktarma sınırsız için `Infinity` verir. */
  rowLimit?: number
}): Promise<ExpenseReportResult> {
  const companyId = args.companyId
  const bounds = resolvePeriodBounds(args.startDate, args.endDate)
  const date = periodWhere(bounds)
  const rowLimit = args.rowLimit ?? EXPENSE_ROW_LIMIT
  const categoryFilter = args.category?.trim() || null

  // Önceki dönem: AYNI uzunlukta, hemen öncesi. Takvimsel değil gün bazlı çünkü
  // buraya serbest tarih aralığı da gelebilir (kutudan seçilen dönem).
  const span = bounds.endExclusive.getTime() - bounds.start.getTime()
  const previousStart = new Date(bounds.start.getTime() - span)

  const [invoices, uninvoiced, previousInvoices, previousReturns, previousUninvoiced] =
    await Promise.all([
    prisma.invoice.findMany({
      where: {
        companyId,
        // Alış ailesi: alış faturaları + alış İADELERİ (eksi olarak sayılır).
        OR: [{ type: "PURCHASE" }, { type: "RETURN", returnKind: "PURCHASE" }],
        status: { notIn: POSTED_STATUSES },
        date,
      },
      select: {
        id: true,
        slug: true,
        invoiceNo: true,
        type: true,
        returnKind: true,
        isReceipt: true,
        netAmount: true,
        category: true,
        tags: true,
        date: true,
        supplier: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { date: "desc" },
    }),

    // Faturasız (serbest) giderler. Süzgeç kâr/zarardaki "Diğer Giderler" ile
    // birebir aynı: faturaya bağlı ödeme elenir (çift sayım), virman bacağı
    // elenir (kendi cebinden cebine para gider değildir).
    prisma.transaction.findMany({
      where: {
        companyId,
        type: "EXPENSE",
        date,
        invoicePayments: { none: {} },
        ...NOT_TRANSFER_WHERE,
      },
      select: {
        id: true,
        date: true,
        description: true,
        category: true,
        tags: true,
        amount: true,
      },
      orderBy: { date: "desc" },
    }),

    // Önceki dönem YALNIZ TOPLAM için: kalemleri çekmeye gerek yok. Alış iadesi
    // burada da düşülür — düşülmeseydi karşılaştırma, iade kesilen bir dönemi
    // olduğundan pahalı gösterip "gider %20 azaldı" gibi sahte bir iyileşme
    // üretirdi.
    prisma.invoice.aggregate({
      where: {
        companyId,
        type: "PURCHASE",
        status: { notIn: POSTED_STATUSES },
        date: { gte: previousStart, lt: bounds.start },
      },
      _sum: { netAmount: true },
    }),
    prisma.invoice.aggregate({
      where: {
        companyId,
        type: "RETURN",
        returnKind: "PURCHASE",
        status: { notIn: POSTED_STATUSES },
        date: { gte: previousStart, lt: bounds.start },
      },
      _sum: { netAmount: true },
    }),
    prisma.transaction.aggregate({
      where: {
        companyId,
        type: "EXPENSE",
        date: { gte: previousStart, lt: bounds.start },
        invoicePayments: { none: {} },
        ...NOT_TRANSFER_WHERE,
      },
      _sum: { amount: true },
    }),
  ])

  const rows: ExpenseRow[] = []

  for (const invoice of invoices) {
    const isReturn = isPurchaseReturn(invoice)
    const amount = (isReturn ? -1 : 1) * Number(invoice.netAmount || 0)
    rows.push({
      id: invoice.id,
      kind: "invoice",
      date: invoice.date.toISOString(),
      label: invoice.invoiceNo,
      // Kart adresi: SEF slug varsa o, yoksa id (satış/alış raporuyla aynı desen).
      documentRef: invoice.slug || invoice.id,
      isReceipt: invoice.isReceipt,
      isReturn,
      supplierName: invoice.supplier?.name ?? null,
      supplierRef: invoice.supplier ? invoice.supplier.slug || invoice.supplier.id : null,
      category: invoice.category?.trim() || null,
      tags: Array.isArray(invoice.tags) ? invoice.tags : [],
      amount,
    })
  }

  for (const row of uninvoiced as unknown as UninvoicedRow[]) {
    rows.push({
      id: row.id,
      kind: "transaction",
      date: new Date(row.date).toISOString(),
      label: row.description?.trim() || "Faturasız gider",
      documentRef: null,
      isReceipt: false,
      isReturn: false,
      supplierName: null,
      supplierRef: null,
      category: row.category?.trim() || null,
      tags: Array.isArray(row.tags) ? row.tags : [],
      amount: Number(row.amount || 0),
    })
  }

  // SÜZGEÇ ANA KATEGORİYE göredir: "Personel" seçildiğinde "Personel > Maaş" ve
  // "Personel > SGK" birlikte gelir. Tam metin eşleşmesi olsaydı ağacın üst
  // satırına tıklamak boş liste getirirdi.
  const visible = categoryFilter
    ? rows.filter((row) => splitCategory(row.category).main === categoryFilter)
    : rows

  // Kategori listesi SÜZGEÇTEN ÖNCEKİ kümeden çıkar; yoksa bir kategori seçince
  // seçicide o kategoriden başkası kalmaz ve geri dönülemez.
  const categories = Array.from(
    new Set(rows.map((row) => splitCategory(row.category).main))
  ).sort((a, b) => a.localeCompare(b, "tr"))

  const treeEntries: ExpenseTreeEntry[] = visible.map((row) => ({
    amount: row.amount,
    category: row.category,
    count: 1,
  }))

  // Etiket / tedarikçi / ay kırılımları gelir-gider raporunun SAF modülünden
  // gelir: aynı sıralama, aynı yuvarlama, aynı "belge birden çok etikete girer"
  // davranışı. Burada yeniden yazılsaydı iki rapor sessizce ayrışırdı.
  const classified: ClassifiedEntry[] = visible.map((row) => ({
    direction: "expense",
    amount: row.amount,
    category: row.category,
    tags: row.tags,
    month: monthKey(new Date(row.date)),
    partyKey: row.supplierRef,
    partyLabel: row.supplierName,
    partyRef: row.supplierRef,
    partyKind: "supplier",
    count: 1,
  }))
  const breakdowns = buildBreakdowns(classified)

  const invoicedTotal = round2(
    visible.filter((row) => row.kind === "invoice").reduce((sum, row) => sum + row.amount, 0)
  )
  const uninvoicedTotal = round2(
    visible.filter((row) => row.kind === "transaction").reduce((sum, row) => sum + row.amount, 0)
  )
  const total = round2(invoicedTotal + uninvoicedTotal)

  // Defter TARİHE göre sıralanır (en yeni üstte): harcama listesi taranarak
  // okunur, tutara göre sıralamak "geçen hafta ne harcadım"ı bulunamaz yapardı.
  visible.sort((a, b) => b.date.localeCompare(a.date))

  return {
    period: {
      startDate: bounds.start.toISOString(),
      endDate: new Date(bounds.endExclusive.getTime() - 1).toISOString(),
    },
    totals: {
      total,
      invoiced: invoicedTotal,
      uninvoiced: uninvoicedTotal,
      count: visible.length,
      monthlyAverage: round2(total / monthSpan(bounds.start, bounds.endExclusive)),
    },
    previousTotal: round2(
      Number(previousInvoices._sum.netAmount || 0) -
        Number(previousReturns._sum.netAmount || 0) +
        Number(previousUninvoiced._sum.amount || 0)
    ),
    tree: buildExpenseTree(treeEntries),
    byTag: breakdowns.byTag,
    bySupplier: breakdowns.byParty,
    byMonth: breakdowns.byMonth,
    rows: Number.isFinite(rowLimit) ? visible.slice(0, rowLimit) : visible,
    truncated: Number.isFinite(rowLimit) && visible.length > rowLimit,
    uncategorizedCount: visible.filter((row) => !row.category).length,
    categories,
  }
}
