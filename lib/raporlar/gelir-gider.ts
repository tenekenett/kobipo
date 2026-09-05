/**
 * GELİR-GİDER (KARLILIK) RAPORU — kategori ve etiket kırılımlı.
 *
 * Paraşüt'ün "Gelir-Gider (Karlılık) Raporu"nun karşılığı: aynı dönemin
 * kârlılığını hangi GİDER/GELİR GRUBUNUN (kategori) ve hangi PROJE/ŞUBE/
 * KAMPANYANIN (etiket) ürettiğini gösterir. Veri modeli baştan beri hazırdı —
 * `Invoice.category` ve `Invoice.tags[]` fatura editöründen doldurulup
 * `(companyId, category)` üzerinde indexleniyordu — ama hiçbir rapor okumuyordu.
 *
 * TOPLAMLARI KÂR/ZARARLA AYNIDIR ve öyle kalmalıdır: ölçü `netAmount`, iadeler
 * kendi ailesinden düşülür, faturaya bağlı tahsilat/ödeme işlemleri çift
 * sayılmasın diye elenir, virman bacakları gelir sayılmaz. İki rapor ayrışırsa
 * kullanıcı hangisine güveneceğini bilemez.
 *
 * Kırılım aritmetiği `gelir-gider-kirilim.ts`te (saf, testli).
 */

import { prisma } from "@/lib/db/prisma"
import { isPurchaseReturn, isSalesReturn } from "@/lib/cari/invoice-direction"
import { periodWhere, resolvePeriodBounds } from "./date-range"
import {
  buildBreakdowns,
  type Breakdowns,
  type ClassifiedEntry,
} from "./gelir-gider-kirilim"

/** Kategorisi GİRİLMEMİŞ faturasız kasa hareketlerinin toplandığı satır. */
export const UNINVOICED_CATEGORY = "Faturasız işlemler (kategorisiz)"

export type IncomeExpenseResult = {
  period: { startDate: string; endDate: string }
  totals: Breakdowns["totals"]
  byCategory: Breakdowns["byCategory"]
  byTag: Breakdowns["byTag"]
  byParty: Breakdowns["byParty"]
  byMonth: Breakdowns["byMonth"]
  /** Kaç belge kategorisiz — "kırılım eksik" uyarısını ekran buradan verir. */
  uncategorized: { count: number; revenue: number; expense: number }
}

const POSTED_STATUSES = ["CANCELLED", "CONVERTED"]

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

type UninvoicedRow = {
  month: Date
  category: string | null
  total: unknown
  entries: unknown
}

export type UninvoicedGroup = {
  month: string
  category: string | null
  total: number
  entries: number
}

/**
 * Faturasız (serbest) kasa hareketlerinin AY ve KATEGORİ bazında toplamı.
 *
 * Ham SQL çünkü Prisma `groupBy` bir tarih sütununu aya indirgeyemiyor; ay
 * kırılımı olmadan tüm dönem tek aya yığılır ve aylık grafik yalan söylerdi.
 * Süzgeç `kar-zarar.ts`teki "Diğer Gelirler/Giderler" ile birebir aynı:
 * faturaya bağlı işlem elenir (çift sayım), virman bacağı elenir (kendi
 * cebinden cebine para).
 *
 * `category` sütunu 2026-09-05'te eklendi; öncesinde faturasız giderlerin
 * tamamı tek bir "Faturasız işlemler" satırına yığılıyor ve "personel gideri ne
 * kadar" sorusu cevapsız kalıyordu. Kategorisi girilmemiş ESKİ kayıtlar hâlâ o
 * satırda toplanır (NULL).
 */
async function uninvoicedGroups(
  companyId: string,
  type: "INCOME" | "EXPENSE",
  start: Date,
  endExclusive: Date
): Promise<UninvoicedGroup[]> {
  const rows = await prisma.$queryRaw<UninvoicedRow[]>`
    SELECT
      date_trunc('month', t."date")::date AS month,
      NULLIF(BTRIM(COALESCE(t."category", '')), '') AS category,
      COALESCE(SUM(t.amount), 0) AS total,
      COUNT(*) AS entries
    FROM "transactions" t
    WHERE t."companyId" = ${companyId}
      AND t."type" = ${type}
      AND t."date" >= ${start} AND t."date" < ${endExclusive}
      AND (t."reference" IS NULL OR t."reference" NOT LIKE 'TRANSFER:%')
      AND NOT EXISTS (
        SELECT 1 FROM "invoice_payments" p WHERE p."transactionId" = t.id
      )
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `
  return rows.map((row) => ({
    month: monthKey(new Date(row.month)),
    category: row.category,
    total: Number(row.total ?? 0),
    entries: Number(row.entries ?? 0),
  }))
}

export async function computeIncomeExpense(args: {
  companyId: string
  startDate?: string | null
  endDate?: string | null
}): Promise<IncomeExpenseResult> {
  const companyId = args.companyId
  const bounds = resolvePeriodBounds(args.startDate, args.endDate)
  const date = periodWhere(bounds)

  const [invoices, otherIncome, otherExpense] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        companyId,
        type: { in: ["SALES", "PURCHASE", "RETURN"] },
        status: { notIn: POSTED_STATUSES },
        date,
      },
      select: {
        id: true,
        type: true,
        returnKind: true,
        netAmount: true,
        category: true,
        tags: true,
        date: true,
        // id/slug satırı cari kartına bağlamak için (satış/alış raporuyla aynı desen).
        customer: { select: { id: true, name: true, slug: true } },
        supplier: { select: { id: true, name: true, slug: true } },
      },
    }),
    // Faturasız gelir/gider — kâr/zarardaki "Diğer Gelirler/Giderler" ile AYNI
    // süzgeç: faturaya bağlı işlem çift sayılmasın, virman bacağı gelir olmasın.
    //
    // AYA GÖRE gruplanır: dönemin tamamı tek toplam olarak alınsaydı aylık
    // kırılımda hepsi ilk aya yığılır ve trend grafiği yalan söylerdi.
    uninvoicedGroups(companyId, "INCOME", bounds.start, bounds.endExclusive),
    uninvoicedGroups(companyId, "EXPENSE", bounds.start, bounds.endExclusive),
  ])

  const entries: ClassifiedEntry[] = []
  let uncategorizedCount = 0
  let uncategorizedRevenue = 0
  let uncategorizedExpense = 0

  for (const invoice of invoices) {
    const salesReturn = isSalesReturn(invoice)
    const purchaseReturn = isPurchaseReturn(invoice)
    const isRevenue = invoice.type === "SALES" || salesReturn
    // İade kendi ailesinin EKSİSİDİR; ayrı kalem açılmaz.
    const sign = salesReturn || purchaseReturn ? -1 : 1
    const amount = sign * Number(invoice.netAmount || 0)

    const party = isRevenue ? invoice.customer : invoice.supplier
    const category = invoice.category?.trim() || null

    if (!category) {
      uncategorizedCount += 1
      if (isRevenue) uncategorizedRevenue += amount
      else uncategorizedExpense += amount
    }

    entries.push({
      direction: isRevenue ? "revenue" : "expense",
      amount,
      category,
      tags: Array.isArray(invoice.tags) ? invoice.tags : [],
      month: monthKey(new Date(invoice.date)),
      // Carisiz belge (perakende/hızlı satış) cari kırılımına GİRMEZ: tek bir
      // "Tanımsız" satırında toplanması kırılımı bilgi vermeyen bir yığına çevirir.
      partyKey: party ? party.id : null,
      partyLabel: party ? party.name : null,
      // Kart adresi: SEF slug varsa o, yoksa id (satış/alış raporuyla aynı desen).
      partyRef: party ? party.slug || party.id : null,
      partyKind: party ? (isRevenue ? "customer" : "supplier") : null,
      count: 1,
    })
  }

  // Faturasız hareketler KENDİ kategorileriyle girer; kategorisi girilmemiş
  // olanlar tek bir "Faturasız işlemler" satırında toplanır. Rapora hiç
  // girmeselerdi toplam, kâr/zarardaki net kârı tutmazdı.
  const pushUninvoiced = (direction: "revenue" | "expense", rows: UninvoicedGroup[]) => {
    for (const row of rows) {
      if (!row.category) {
        uncategorizedCount += row.entries
        if (direction === "revenue") uncategorizedRevenue += row.total
        else uncategorizedExpense += row.total
      }
      entries.push({
        direction,
        amount: row.total,
        category: row.category ?? UNINVOICED_CATEGORY,
        tags: [],
        month: row.month,
        partyKey: null,
        partyLabel: null,
        partyRef: null,
        partyKind: null,
        count: row.entries,
      })
    }
  }
  pushUninvoiced("revenue", otherIncome)
  pushUninvoiced("expense", otherExpense)

  const breakdowns = buildBreakdowns(entries)

  return {
    // Dönem sonu EKRANDA kapsayıcı gösterilir (sınır dışlayıcıdır).
    period: {
      startDate: bounds.start.toISOString(),
      endDate: new Date(bounds.endExclusive.getTime() - 1).toISOString(),
    },
    totals: breakdowns.totals,
    byCategory: breakdowns.byCategory,
    byTag: breakdowns.byTag,
    byParty: breakdowns.byParty,
    byMonth: breakdowns.byMonth,
    uncategorized: {
      count: uncategorizedCount,
      revenue: uncategorizedRevenue,
      expense: uncategorizedExpense,
    },
  }
}
