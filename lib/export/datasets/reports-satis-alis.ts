/**
 * Satış / alış raporu dışa aktarımı.
 *
 * İki ekran aynı gövdeyi paylaşıyor (tek fark `type`), bu yüzden tek dataset
 * kurucusu iki kayıt olarak sunuluyor.
 */

import { computeSalesPurchaseReport, type SalesPurchaseKind } from "@/lib/raporlar/satis-alis"
import {
  salesPurchaseSections,
  type SalesPurchaseSectionKey,
} from "@/lib/raporlar/satis-alis-sections"
import type { ExportColumn, ExportDataset } from "../types"
import { loadExportCompany, describeDateRange, describeFilters } from "./context"

/** Cari kartındaki tanımlar — hem cari sayfasında hem fatura satırlarında aynı iki sütun. */
const CLASS_COLUMNS: ExportColumn[] = [
  { key: "class1", label: "Sınıflandırma 1", width: 26 },
  { key: "class2", label: "Sınıflandırma 2", width: 26 },
]

const MONTHLY_COLUMNS: ExportColumn[] = [
  { key: "label", label: "Dönem", width: 40 },
  { key: "count", label: "Fatura Adedi", type: "number", width: 30, total: true },
  { key: "amount", label: "Tutar", type: "money", width: 40, total: true },
]

function counterpartyColumns(isSales: boolean): ExportColumn[] {
  return [
    { key: "name", label: isSales ? "Müşteri" : "Tedarikçi", width: 70 },
    ...CLASS_COLUMNS,
    { key: "count", label: "Fatura Adedi", type: "number", width: 25, total: true },
    { key: "amount", label: "Tutar", type: "money", width: 35, total: true },
  ]
}

function invoiceColumns(isSales: boolean): ExportColumn[] {
  return [
    { key: "date", label: "Tarih", type: "date", width: 22 },
    { key: "invoiceNo", label: "Fatura No", width: 30 },
    { key: "counterpartyName", label: isSales ? "Müşteri" : "Tedarikçi" },
    ...CLASS_COLUMNS,
    // İade satırlarının tutarları EKSİ gelir; sütun olmasaydı okuyan kişi
    // negatif rakamı hata sanardı.
    { key: "belge", label: "Belge", width: 18 },
    { key: "status", label: "Durum", width: 22 },
    { key: "netAmount", label: "Matrah", type: "money", width: 26, total: true },
    { key: "vatAmount", label: "KDV", type: "money", width: 24, total: true },
    { key: "totalAmount", label: "Genel Toplam", type: "money", width: 28, total: true },
  ]
}

/**
 * "Detaylı Faturalar" sayfası: her satır bir FATURA KALEMİDİR ve faturanın
 * kimliğini (tarih, no, cari, tanım) tekrar taşır. Satırlar fatura fatura
 * sıralıdır — yani her faturanın altında o faturada satılan stok/hizmetler
 * gelir — ama kimlik tekrarlandığı için Excel'de tek başına süzülüp
 * pivotlanabilir.
 */
function invoiceLineColumns(isSales: boolean): ExportColumn[] {
  return [
    { key: "date", label: "Tarih", type: "date", width: 22 },
    { key: "invoiceNo", label: "Fatura No", width: 30 },
    { key: "eDocumentNo", label: "e-Belge No", width: 30 },
    { key: "counterpartyName", label: isSales ? "Müşteri" : "Tedarikçi" },
    ...CLASS_COLUMNS,
    { key: "belge", label: "Belge", width: 18 },
    { key: "productCode", label: "Stok Kodu", width: 24 },
    { key: "description", label: "Stok / Hizmet" },
    { key: "kind", label: "Tür", width: 18 },
    { key: "quantity", label: "Miktar", type: "qty", width: 18, total: true },
    { key: "unit", label: "Birim", width: 14, align: "center" },
    { key: "unitPrice", label: "Birim Fiyat", type: "money", width: 24 },
    { key: "discountAmount", label: "İskonto", type: "money", width: 22, total: true },
    { key: "vatRate", label: "KDV %", type: "number", width: 16 },
    { key: "vatAmount", label: "KDV", type: "money", width: 22, total: true },
    { key: "totalAmount", label: "Satır Toplamı", type: "money", width: 26, total: true },
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
    computeSalesPurchaseReport({ ...params, includeLines: true }),
  ])

  const title = isSales ? "Satış Raporu" : "Alış Raporu"

  // Başlık ve sayfa adları ekranın kartlarıyla AYNI kaynaktan gelir: kullanıcı
  // "Faturalar kartındaki rakam Excel'in hangi sekmesinde" diye sormamalı.
  const sections = salesPurchaseSections(params.type)
  const meta = (key: SalesPurchaseSectionKey) => {
    const section = sections.find((s) => s.key === key)!
    return { title: section.title, sheetName: section.sheetName }
  }

  return {
    title,
    company,
    filters: describeFilters([
      ["Dönem", describeDateRange(params.startDate, params.endDate) ?? "Tüm kayıtlar"],
      ["Fatura adedi", report.count],
      ["İade adedi", report.invoices.filter((i) => i.isReturn).length],
      ["Kalem adedi", report.lines.length],
      [isSales ? "Toplam ciro" : "Toplam alış", report.totalAmount.toLocaleString("tr-TR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })],
    ]),
    sections: [
      {
        ...meta("aylik"),
        columns: MONTHLY_COLUMNS,
        rows: report.monthly,
      },
      {
        ...meta("cariler"),
        columns: counterpartyColumns(isSales),
        rows: report.topCounterparties,
      },
      {
        ...meta("faturalar"),
        columns: invoiceColumns(isSales),
        rows: report.invoices.map((inv) => ({
          ...inv,
          belge: inv.isReturn ? "İade" : isSales ? "Satış" : "Alış",
        })),
      },
      {
        ...meta("kalemler"),
        columns: invoiceLineColumns(isSales),
        rows: report.lines.map((line) => ({
          ...line,
          belge: line.isReturn ? "İade" : isSales ? "Satış" : "Alış",
        })),
      },
    ],
    generatedAt: new Date(),
  }
}
