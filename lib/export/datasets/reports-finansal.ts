/**
 * Finansal tablo dışa aktarımları: bilanço, nakit akışı, gelir-gider, harcamalar.
 *
 * (Kar/zarar `reports.ts` içinde — ilk turda oraya yazılmıştı.)
 */

import { computeBalanceSheet } from "@/lib/raporlar/bilanco"
import { computeCashFlow } from "@/lib/raporlar/nakit-akisi"
import { computeIncomeExpense } from "@/lib/raporlar/gelir-gider"
import { computeExpenseReport } from "@/lib/raporlar/harcamalar"
import type { BreakdownRow } from "@/lib/raporlar/gelir-gider-kirilim"
import type { ExportColumn, ExportDataset } from "../types"
import { loadExportCompany, describeDateRange, describeFilters } from "./context"
import { formatCellText } from "../values"

/** Finansal tablolar hep "Kalem / Tutar" iki kolonlu. */
const STATEMENT_COLUMNS: ExportColumn[] = [
  { key: "label", label: "Kalem", width: 90 },
  { key: "amount", label: "Tutar", type: "money", width: 45 },
]

// --------------------------- BİLANÇO ---------------------------

export async function buildBalanceSheetDataset(params: {
  companyId: string
  asOfDate?: string | null
}): Promise<ExportDataset> {
  const [company, report] = await Promise.all([
    loadExportCompany(params.companyId),
    computeBalanceSheet(params),
  ])

  return {
    title: "Bilanço",
    company,
    orientation: "portrait",
    filters: describeFilters([["Tarih itibarıyla", formatCellText(report.asOfDate, "date")]]),
    sections: [
      {
        title: "Aktifler (Varlıklar)",
        sheetName: "Aktifler",
        columns: STATEMENT_COLUMNS,
        totals: { label: "Toplam Aktif", amount: report.assets.total },
        rows: [
          { label: "Nakit ve banka hesapları", amount: report.assets.cashAndBanks },
          { label: "Ticari alacaklar (tahsil edilmemiş)", amount: report.assets.receivables },
          { label: "Tedarikçilere verilen avanslar", amount: report.assets.supplierAdvances },
          { label: "Stoklar", amount: report.assets.inventory },
        ],
      },
      {
        title: "Pasifler (Kaynaklar)",
        sheetName: "Pasifler",
        columns: STATEMENT_COLUMNS,
        totals: { label: "Toplam Pasif + Öz Kaynak", amount: report.totalLiabilitiesAndEquity },
        rows: [
          { label: "Ticari borçlar (ödenmemiş)", amount: report.liabilities.payables },
          { label: "Müşterilerden alınan avanslar", amount: report.liabilities.customerAdvances },
          { label: "Geçmiş dönem + dönem kârı", amount: report.equity.retainedEarnings },
          { label: "Sermaye ve diğer düzeltmeler", amount: report.equity.adjustments },
        ],
      },
      {
        // Denge artık TANIM GEREĞİ tutuyor (öz sermaye = aktif − yükümlülük);
        // bölüm, dosyayı okuyanın kimliği kendi gözüyle doğrulaması için duruyor.
        title: "Denge",
        sheetName: "Denge",
        columns: STATEMENT_COLUMNS,
        totals: null,
        rows: [
          { label: "Toplam aktif", amount: report.total },
          { label: "Toplam pasif + öz kaynak", amount: report.totalLiabilitiesAndEquity },
          { label: "Fark", amount: report.total - report.totalLiabilitiesAndEquity },
        ],
      },
    ],
    generatedAt: new Date(),
  }
}

// --------------------------- NAKİT AKIŞI ---------------------------

export async function buildCashFlowDataset(params: {
  companyId: string
  startDate?: string | null
  endDate?: string | null
}): Promise<ExportDataset> {
  const [company, report] = await Promise.all([
    loadExportCompany(params.companyId),
    computeCashFlow(params),
  ])

  return {
    title: "Nakit Akış Tablosu",
    company,
    orientation: "portrait",
    filters: describeFilters([
      ["Dönem", describeDateRange(report.period.startDate, report.period.endDate)],
    ]),
    sections: [
      {
        title: "İşletme Faaliyetleri",
        sheetName: "İşletme",
        columns: STATEMENT_COLUMNS,
        totals: { label: "İşletme Faaliyetleri Net", amount: report.operatingActivities.net },
        rows: [
          { label: "Faturalardan tahsilat", amount: report.operatingActivities.collections },
          { label: "Faturalara ödeme (−)", amount: -report.operatingActivities.payments },
          { label: "Diğer gelirler (faturasız)", amount: report.operatingActivities.otherIncome },
          { label: "Diğer giderler (faturasız) (−)", amount: -report.operatingActivities.otherExpense },
        ],
      },
      {
        title: "Özet",
        sheetName: "Özet",
        columns: STATEMENT_COLUMNS,
        totals: null,
        rows: [
          { label: "Dönem başı nakit", amount: report.beginningBalance },
          { label: "İşletme faaliyetleri", amount: report.operatingActivities.net },
          { label: "Sınıflandırılmamış hareketler", amount: report.unclassified },
          { label: "NET NAKİT AKIŞI", amount: report.netCashFlow },
          { label: "Dönem sonu nakit", amount: report.endingBalance },
        ],
      },
    ],
    generatedAt: new Date(),
  }
}

// --------------------------- GELİR-GİDER (KARLILIK) ---------------------------

/** Kırılım sayfalarının ortak kolonları. */
const BREAKDOWN_COLUMNS: ExportColumn[] = [
  { key: "label", label: "Kalem", width: 60 },
  { key: "revenue", label: "Gelir", type: "money", width: 30 },
  { key: "expense", label: "Gider", type: "money", width: 30 },
  { key: "profit", label: "Kâr", type: "money", width: 30 },
  { key: "count", label: "Belge", width: 15 },
]

function breakdownRows(rows: BreakdownRow[]) {
  return rows.map((row) => ({
    label: row.label,
    revenue: row.revenue,
    expense: row.expense,
    profit: row.profit,
    count: row.count,
  }))
}

export async function buildIncomeExpenseDataset(params: {
  companyId: string
  startDate?: string | null
  endDate?: string | null
}): Promise<ExportDataset> {
  const [company, report] = await Promise.all([
    loadExportCompany(params.companyId),
    computeIncomeExpense(params),
  ])

  const totalsRow = {
    label: "TOPLAM",
    revenue: report.totals.revenue,
    expense: report.totals.expense,
    profit: report.totals.profit,
    count: "",
  }

  return {
    title: "Gelir-Gider (Karlılık) Raporu",
    company,
    orientation: "landscape",
    filters: describeFilters([
      ["Dönem", describeDateRange(report.period.startDate, report.period.endDate)],
    ]),
    sections: [
      {
        title: "Kategori Kırılımı",
        sheetName: "Kategori",
        columns: BREAKDOWN_COLUMNS,
        totals: totalsRow,
        rows: breakdownRows(report.byCategory),
      },
      {
        // Etiket toplamı genel toplamı AŞABİLİR (bir belge birden çok etikete
        // girer); bu yüzden bu sayfada TOPLAM satırı yok — olsaydı "kalemler
        // toplamı başlığı tutmuyor" diye okunurdu.
        title: "Etiket Kırılımı (bir belge birden çok etikete girebilir)",
        sheetName: "Etiket",
        columns: BREAKDOWN_COLUMNS,
        totals: null,
        rows: breakdownRows(report.byTag),
      },
      {
        title: "Cari Kırılımı",
        sheetName: "Cari",
        columns: BREAKDOWN_COLUMNS,
        totals: null,
        rows: breakdownRows(report.byParty),
      },
      {
        title: "Aylık Dağılım",
        sheetName: "Aylık",
        columns: BREAKDOWN_COLUMNS,
        totals: totalsRow,
        rows: breakdownRows(report.byMonth),
      },
    ],
    generatedAt: new Date(),
  }
}

// --------------------------- HARCAMALAR ---------------------------

export async function buildExpenseReportDataset(params: {
  companyId: string
  startDate?: string | null
  endDate?: string | null
  category?: string | null
}): Promise<ExportDataset> {
  const [company, report] = await Promise.all([
    loadExportCompany(params.companyId),
    // Dosyada kalem TAVANI YOK: ekran 500 satırla sınırlı, dışa aktarma ise
    // "tamamı dosyada" vaadini tutmak zorunda.
    computeExpenseReport({ ...params, rowLimit: Number.POSITIVE_INFINITY }),
  ])

  const treeColumns: ExportColumn[] = [
    { key: "label", label: "Kategori", width: 60 },
    { key: "amount", label: "Tutar", type: "money", width: 30 },
    { key: "sharePct", label: "Pay %", width: 15 },
    { key: "count", label: "Kalem", width: 15 },
  ]

  // Ağaç dosyada DÜZ satırlara açılır (Excel'de girinti taşınmaz); alt kategori
  // "Ana > Alt" tam adıyla yazılır ki satır tek başına da anlaşılsın.
  const treeRows: Array<Record<string, unknown>> = []
  for (const group of report.tree.groups) {
    treeRows.push({
      label: group.label,
      amount: group.amount,
      sharePct: group.sharePct,
      count: group.count,
    })
    for (const child of group.children) {
      treeRows.push({
        label: `${group.label} > ${child.label}`,
        amount: child.amount,
        sharePct: child.sharePct,
        count: child.count,
      })
    }
  }

  const ledgerColumns: ExportColumn[] = [
    { key: "date", label: "Tarih", type: "date", width: 22 },
    { key: "label", label: "Belge / Açıklama", width: 40 },
    { key: "supplier", label: "Tedarikçi", width: 40 },
    { key: "category", label: "Kategori", width: 35 },
    { key: "tags", label: "Etiketler", width: 30 },
    { key: "amount", label: "Tutar", type: "money", width: 30 },
  ]

  return {
    title: "Harcamalar Raporu",
    company,
    orientation: "landscape",
    filters: describeFilters([
      ["Dönem", describeDateRange(report.period.startDate, report.period.endDate)],
      ["Kategori", params.category?.trim() || "Tümü"],
    ]),
    sections: [
      {
        title: "Kategori Kırılımı",
        sheetName: "Kategori",
        columns: treeColumns,
        totals: { label: "TOPLAM", amount: report.totals.total, sharePct: "", count: report.totals.count },
        rows: treeRows,
      },
      {
        title: "Tedarikçi Kırılımı",
        sheetName: "Tedarikçi",
        columns: [
          { key: "label", label: "Tedarikçi", width: 60 },
          { key: "expense", label: "Tutar", type: "money", width: 30 },
          { key: "count", label: "Belge", width: 15 },
        ],
        totals: null,
        rows: report.bySupplier.map((row) => ({
          label: row.label,
          expense: row.expense,
          count: row.count,
        })),
      },
      {
        title: "Aylık Dağılım",
        sheetName: "Aylık",
        columns: [
          { key: "label", label: "Ay", width: 30 },
          { key: "expense", label: "Tutar", type: "money", width: 30 },
          { key: "count", label: "Kalem", width: 15 },
        ],
        totals: { label: "TOPLAM", expense: report.totals.total, count: report.totals.count },
        rows: report.byMonth.map((row) => ({
          label: row.label,
          expense: row.expense,
          count: row.count,
        })),
      },
      {
        title: "Harcama Defteri",
        sheetName: "Defter",
        columns: ledgerColumns,
        totals: { date: "", label: "TOPLAM", supplier: "", category: "", tags: "", amount: report.totals.total },
        rows: report.rows.map((row) => ({
          date: row.date,
          label: row.isReturn ? `${row.label} (iade)` : row.label,
          supplier: row.supplierName ?? "",
          category: row.category ?? "",
          tags: row.tags.join(", "),
          amount: row.amount,
        })),
      },
    ],
    generatedAt: new Date(),
  }
}
