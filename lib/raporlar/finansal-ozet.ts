/**
 * FİNANSAL PANO — tek çağrıda panonun tüm rakamları.
 *
 * Pano kendi hesabını YAPMAZ: kâr/zarar `kar-zarar.ts`ten, vade kovaları
 * `cari-yaslandirma.ts`ten, kasa bakiyesi `finans/nakit-hareket.ts`ten gelir.
 * Ayrı hesaplansaydı panodaki "vadesi geçmiş alacak" ile yaşlandırma
 * raporundaki aynı başlık farklı rakam gösterirdi — bu projede tam olarak bu
 * hata bir kez yaşandı (bkz. cari-yaslandirma.ts, `customerId` seçeneği).
 *
 * İleriye dönük eğri de aynı şekilde `nakit-projeksiyon-kova.ts`ten gelir —
 * `/raporlar/nakit-akisi` sekmesindeki projeksiyonla BİREBİR aynı kova mantığı.
 *
 * Panoya ÖZGÜ tek hesap aylık seride: 12 ayın gelir/gider/kâr üçlüsü. Kâr/zarar
 * fonksiyonunu 12 kez çağırmak 72 sorgu ederdi; seri iki toplu sorguyla çıkar.
 */

import { prisma } from "@/lib/db/prisma"
import { cashBalanceBefore } from "@/lib/finans/nakit-hareket"
import { computeCariAging, type AgingAccount, type AgingTotals } from "./cari-yaslandirma"
import { resolvePeriod, type ResolvedPeriod } from "./donem"
import { resolvePeriodBounds } from "./date-range"
import { computeProfitLoss, type ProfitLossResult } from "./kar-zarar"
import {
  buildCashProjection,
  type CashProjection,
  type ProjectionItem,
} from "./nakit-projeksiyon-kova"

const TR_MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"]

/** Aylık serinin uzunluğu — pano grafiğinde bir yıllık trend. */
export const OVERVIEW_MONTHS = 12

export type OverviewParty = {
  /** Tahsil/ödeme bekleyen toplam açık tutar. */
  open: number
  /** Vadesi GEÇMİŞ kısım. */
  overdue: number
  /** Vadesi önümüzdeki 30 günde DOLACAK kısım. */
  dueSoon: number
  /** Vadesi hiç tanımlanmamış belgeler — "gecikmiş" sayılamazlar. */
  noDueDate: number
}

export type OverviewMonth = {
  /** `YYYY-MM` — sıralama ve link için. */
  key: string
  /** "Eyl 26" — grafik ekseninde basılan etiket. */
  label: string
  revenue: number
  expense: number
  profit: number
}

export type FinancialOverviewResult = {
  period: { startDate: string; endDate: string; label: string; presetKey: string }
  profitLoss: ProfitLossResult
  /** Aynı uzunluktaki önceki dönem — ekrandaki "% değişim" bundan çıkar. */
  previous: {
    label: string
    revenue: number
    grossProfit: number
    netProfit: number
  }
  cash: {
    total: number
    accounts: Array<{ id: string; name: string; type: string; balance: number }>
  }
  receivables: OverviewParty
  payables: OverviewParty
  monthly: OverviewMonth[]
  /**
   * Önümüzdeki 12 haftanın nakit eğrisi. Panoda geçmiş trendin YANINDA durur:
   * "geçen yıl iyiydi" ile "önümüzdeki ay para bitiyor" ayrı sorulardır ve
   * ikincisi ancak vadelere bakınca görünür.
   */
  projection: CashProjection
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  const parsed = Number(value as never)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Yaşlandırma hesaplarını projeksiyon kalemlerine çevirir. */
function projectionItems(accounts: AgingAccount[], direction: "in" | "out"): ProjectionItem[] {
  const items: ProjectionItem[] = []
  for (const account of accounts) {
    for (const invoice of account.invoices) {
      if (invoice.openAmount === 0) continue
      items.push({
        dueDate: invoice.effectiveDueDate,
        amount: invoice.openAmount,
        direction,
        hasDueDate: invoice.hasDueDate,
      })
    }
  }
  return items
}

/**
 * Yaşlandırma toplamlarını panonun dört rakamına indirger.
 *
 * `total` ve `overdue` YENİDEN HESAPLANMAZ, `summarize()`ten olduğu gibi
 * alınır: pano ile yaşlandırma raporu aynı başlık altında farklı rakam
 * göstermesin.
 */
function summarizeParty(totals: AgingTotals): OverviewParty {
  return {
    open: totals.total,
    overdue: totals.overdue,
    dueSoon: totals.w0_30,
    noDueDate: totals.no_due,
  }
}

type MonthlyInvoiceRow = {
  month: Date
  sales: unknown
  sales_returns: unknown
  purchases: unknown
  purchase_returns: unknown
}

type MonthlyTransactionRow = { month: Date; income: unknown; expense: unknown }

/**
 * Son `OVERVIEW_MONTHS` ayın gelir/gider serisi.
 *
 * Kâr/zararla AYNI tanımı kullanır: gelir = satış matrahı − satış iadesi +
 * faturasız gelir; gider = alış matrahı − alış iadesi + faturasız gider.
 * Virman bacakları ve faturaya bağlı işlemler dışarıda (bkz. kar-zarar.ts).
 */
async function monthlySeries(companyId: string, until: Date): Promise<OverviewMonth[]> {
  const first = new Date(until.getFullYear(), until.getMonth() - (OVERVIEW_MONTHS - 1), 1)

  const [invoiceRows, transactionRows] = await Promise.all([
    prisma.$queryRaw<MonthlyInvoiceRow[]>`
      SELECT
        date_trunc('month', "date")::date AS month,
        SUM(CASE WHEN "type" = 'SALES' THEN "netAmount" ELSE 0 END) AS sales,
        SUM(CASE WHEN "type" = 'RETURN' AND COALESCE("returnKind", 'SALES') = 'SALES'
                 THEN "netAmount" ELSE 0 END) AS sales_returns,
        SUM(CASE WHEN "type" = 'PURCHASE' THEN "netAmount" ELSE 0 END) AS purchases,
        SUM(CASE WHEN "type" = 'RETURN' AND COALESCE("returnKind", 'SALES') = 'PURCHASE'
                 THEN "netAmount" ELSE 0 END) AS purchase_returns
      FROM "invoices"
      WHERE "companyId" = ${companyId}
        AND "date" >= ${first} AND "date" < ${until}
        AND "status" NOT IN ('CANCELLED', 'CONVERTED')
      GROUP BY 1
      ORDER BY 1 ASC
    `,
    prisma.$queryRaw<MonthlyTransactionRow[]>`
      SELECT
        date_trunc('month', t."date")::date AS month,
        SUM(CASE WHEN t."type" = 'INCOME' THEN t.amount ELSE 0 END) AS income,
        SUM(CASE WHEN t."type" = 'EXPENSE' THEN t.amount ELSE 0 END) AS expense
      FROM "transactions" t
      WHERE t."companyId" = ${companyId}
        AND t."date" >= ${first} AND t."date" < ${until}
        AND (t."reference" IS NULL OR t."reference" NOT LIKE 'TRANSFER:%')
        AND NOT EXISTS (
          SELECT 1 FROM "invoice_payments" p WHERE p."transactionId" = t.id
        )
      GROUP BY 1
      ORDER BY 1 ASC
    `,
  ])

  const byKey = new Map<string, { revenue: number; expense: number }>()
  const keyOf = (value: Date) => {
    const d = new Date(value)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
  }
  const bucket = (key: string) => {
    let row = byKey.get(key)
    if (!row) {
      row = { revenue: 0, expense: 0 }
      byKey.set(key, row)
    }
    return row
  }

  for (const row of invoiceRows) {
    const target = bucket(keyOf(row.month))
    target.revenue += toNumber(row.sales) - toNumber(row.sales_returns)
    target.expense += toNumber(row.purchases) - toNumber(row.purchase_returns)
  }
  for (const row of transactionRows) {
    const target = bucket(keyOf(row.month))
    target.revenue += toNumber(row.income)
    target.expense += toNumber(row.expense)
  }

  // Boş aylar da çizilir: veri olmayan ay grafikten düşerse eksen kayar ve
  // "Mayıs hiç satmadık" bilgisi görünmez olur.
  const out: OverviewMonth[] = []
  const cursor = new Date(first)
  for (let i = 0; i < OVERVIEW_MONTHS; i++) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`
    const value = byKey.get(key) ?? { revenue: 0, expense: 0 }
    out.push({
      key,
      label: `${TR_MONTHS[cursor.getMonth()]} ${String(cursor.getFullYear()).slice(-2)}`,
      revenue: value.revenue,
      expense: value.expense,
      profit: value.revenue - value.expense,
    })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return out
}

export async function computeFinancialOverview(args: {
  companyId: string
  /** `lib/raporlar/donem.ts` hazır seçeneği. Bilinmeyen değer varsayılana düşer. */
  period?: string | null
}): Promise<FinancialOverviewResult> {
  const companyId = args.companyId
  const period: ResolvedPeriod = resolvePeriod(args.period)
  const bounds = resolvePeriodBounds(period.startDate, period.endDate)

  const now = new Date()
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  /**
   * Trend serisi GELECEĞE UZANMAZ: "Bu Yıl" seçiliyken dönem sonu 31 Aralık
   * olduğu için seri Şubat→Ocak aralığına kayıyor, ekranda dört boş gelecek ay
   * çizilirken geçen yılın verisi eksende hiç görünmüyordu. Seri bu yüzden
   * dönem sonu ile BUGÜN'ün erken olanında biter.
   */
  const seriesUntil = bounds.endExclusive < tomorrow ? bounds.endExclusive : tomorrow

  const [profitLoss, previous, aging, accounts, cashTotal, todayCash, monthly] = await Promise.all([
    computeProfitLoss({ companyId, startDate: period.startDate, endDate: period.endDate }),
    computeProfitLoss({
      companyId,
      startDate: period.previous.startDate,
      endDate: period.previous.endDate,
    }),
    // Yaşlandırma BUGÜNE göredir, seçili döneme göre değil: "vadesi geçmiş
    // alacak" geçmiş bir dönem seçildiğinde de bugünkü riski göstermeli.
    computeCariAging(companyId),
    prisma.financialAccount.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true, type: true, balance: true },
      orderBy: { name: "asc" },
    }),
    // Dönem sonundaki nakit — bugünkü bakiye değil (geçmiş dönem seçilebilir).
    cashBalanceBefore(companyId, bounds.endExclusive),
    // Projeksiyonun açılışı ise BUGÜNÜN sonundaki nakit.
    cashBalanceBefore(companyId, tomorrow),
    monthlySeries(companyId, seriesUntil),
  ])

  return {
    period: {
      startDate: period.startDate,
      endDate: period.endDate,
      label: period.label,
      presetKey: args.period ?? "",
    },
    profitLoss,
    previous: {
      label: period.previous.label,
      revenue: previous.revenue.total,
      grossProfit: previous.grossProfit,
      netProfit: previous.netProfit,
    },
    cash: {
      total: cashTotal,
      accounts: accounts.map((account) => ({
        id: account.id,
        name: account.name,
        type: account.type,
        balance: Number(account.balance),
      })),
    },
    receivables: summarizeParty(aging.customers.totals),
    payables: summarizeParty(aging.suppliers.totals),
    monthly,
    // Projeksiyon BUGÜNKÜ nakitten başlar, seçili dönemden değil: "önümüzdeki
    // 12 hafta" sorusunun geçmiş bir dönem seçilmiş olmasıyla ilgisi yok.
    projection: buildCashProjection({
      openingBalance: todayCash,
      granularity: "week",
      items: [
        ...projectionItems(aging.customers.accounts, "in"),
        ...projectionItems(aging.suppliers.accounts, "out"),
      ],
    }),
  }
}
