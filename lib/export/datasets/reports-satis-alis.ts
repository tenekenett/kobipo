/**
 * Satış / alış raporu dışa aktarımı.
 *
 * İki ekran aynı gövdeyi paylaşıyor (tek fark `type`), bu yüzden tek dataset
 * kurucusu iki kayıt olarak sunuluyor.
 */

import { computeSalesPurchaseReport, type SalesPurchaseKind } from "@/lib/raporlar/satis-alis"
import type { ExportColumn, ExportDataset } from "../types"
import { loadExportCompany, describeDateRange, describeFilters } from "./context"

const MONTHLY_COLUMNS: ExportColumn[] = [
  { key: "label", label: "Dönem", width: 40 },
  { key: "count", label: "Fatura Adedi", type: "number", width: 30, total: true },
  { key: "amount", label: "Tutar", type: "money", width: 40, total: true },
]

function counterpartyColumns(isSales: boolean): ExportColumn[] {
  return [
    { key: "name", label: isSales ? "Müşteri" : "Tedarikçi", width: 70 },
    { key: "count", label: "Fatura Adedi", type: "number", width: 25, total: true },
    { key: "amount", label: "Tutar", type: "money", width: 35, total: true },
  ]
}

function invoiceColumns(isSales: boolean): ExportColumn[] {
  return [
    { key: "date", label: "Tarih", type: "date", width: 22 },
    { key: "invoiceNo", label: "Fatura No", width: 30 },
    { key: "counterpartyName", label: isSales ? "Müşteri" : "Tedarikçi" },
    // İade satırlarının tutarları EKSİ gelir; sütun olmasaydı okuyan kişi
    // negatif rakamı hata sanardı.
    { key: "belge", label: "Belge", width: 18 },
    { key: "status", label: "Durum", width: 22 },
    { key: "netAmount", label: "Matrah", type: "money", width: 26, total: true },
    { key: "vatAmount", label: "KDV", type: "money", width: 24, total: true },
    { key: "totalAmount", label: "Genel Toplam", type: "money", width: 28, total: true },
  ]
}

export async function buildSalesPurchaseDataset(params: {
  companyId: string
  type: SalesPurchaseKind
  startDate?: string | null
  endDate?: string | null
}): Promise<ExportDataset> {
  const isSales = params.type === "SALES"
  const [company, report] = await Promise.all([
    loadExportCompany(params.companyId),
    computeSalesPurchaseReport(params),
  ])

  const title = isSales ? "Satış Raporu" : "Alış Raporu"

  return {
    title,
    company,
    filters: describeFilters([
      ["Dönem", describeDateRange(params.startDate, params.endDate) ?? "Tüm kayıtlar"],
      ["Fatura adedi", report.count],
      ["İade adedi", report.invoices.filter((i) => i.isReturn).length],
      [isSales ? "Toplam ciro" : "Toplam alış", report.totalAmount.toLocaleString("tr-TR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })],
    ]),
    sections: [
      {
        title: "Aylık Dağılım",
        sheetName: "Aylık",
        columns: MONTHLY_COLUMNS,
        rows: report.monthly,
      },
      {
        title: isSales ? "En Çok Satış Yapılan Müşteriler" : "En Çok Alış Yapılan Tedarikçiler",
        sheetName: isSales ? "Müşteriler" : "Tedarikçiler",
        columns: counterpartyColumns(isSales),
        rows: report.topCounterparties,
      },
      {
        title: "Faturalar",
        sheetName: "Faturalar",
        columns: invoiceColumns(isSales),
        rows: report.invoices.map((inv) => ({
          ...inv,
          belge: inv.isReturn ? "İade" : isSales ? "Satış" : "Alış",
        })),
      },
    ],
    generatedAt: new Date(),
  }
}
