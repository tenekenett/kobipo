/**
 * Finansal tablo dışa aktarımları: bilanço, nakit akışı.
 *
 * (Kar/zarar `reports.ts` içinde — ilk turda oraya yazılmıştı.)
 */

import { computeBalanceSheet } from "@/lib/raporlar/bilanco"
import { computeCashFlow } from "@/lib/raporlar/nakit-akisi"
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
          { label: "Öz kaynaklar", amount: report.equity },
        ],
      },
      {
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
          { label: "Müşterilerden doğrudan tahsilatlar", amount: report.operatingActivities.collections },
          { label: "Gelir işlemleri (tüm INCOME)", amount: report.operatingActivities.otherIncome },
          { label: "Tedarikçilere doğrudan ödemeler (−)", amount: -report.operatingActivities.payments },
          { label: "Gider işlemleri (tüm EXPENSE) (−)", amount: -report.operatingActivities.otherExpense },
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
          { label: "Yatırım faaliyetleri", amount: report.investingActivities.net },
          { label: "Finansman faaliyetleri", amount: report.financingActivities.net },
          { label: "NET NAKİT AKIŞI", amount: report.netCashFlow },
          { label: "Dönem sonu nakit", amount: report.endingBalance },
        ],
      },
    ],
    generatedAt: new Date(),
  }
}
