/**
 * Vergi beyanname hazırlık raporu dışa aktarımı — KDV + Muhtasar + Ba-Bs tek
 * belgede.
 *
 * Ekranda üç sekme var ama üçü de aynı dönemin (yıl/ay) parçaları; muhasebeciye
 * gönderilirken üç ayrı dosya değil tek dosya isteniyor.
 */

import { computeBaBs, computeVatDeclaration, computeWithholding } from "@/lib/raporlar/vergiler"
import type { ExportColumn, ExportDataset, ExportSection } from "../types"
import { loadExportCompany, describeFilters } from "./context"

const MONTHS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
]

const VAT_BREAKDOWN_COLUMNS: ExportColumn[] = [
  { key: "vatRate", label: "KDV Oranı", type: "percent", width: 30 },
  { key: "totalAmount", label: "Tutar", type: "money", width: 45, total: true },
  { key: "vatAmount", label: "KDV", type: "money", width: 45, total: true },
]

const BABS_COLUMNS: ExportColumn[] = [
  { key: "date", label: "Tarih", type: "date", width: 22 },
  { key: "invoiceNo", label: "Fatura No", width: 30 },
  { key: "counterpartyName", label: "Karşı Taraf" },
  { key: "counterpartyTaxNumber", label: "VKN/TCKN", width: 28 },
  { key: "netAmount", label: "Matrah", type: "money", width: 28, total: true },
  { key: "vatAmount", label: "KDV", type: "money", width: 26, total: true },
  { key: "totalAmount", label: "Genel Toplam", type: "money", width: 30, total: true },
]

export async function buildTaxReportDataset(params: {
  companyId: string
  year: number
  month: number
}): Promise<ExportDataset> {
  const [company, vat, withholding, baBs] = await Promise.all([
    loadExportCompany(params.companyId),
    computeVatDeclaration({ ...params, period: "monthly" }),
    computeWithholding(params),
    computeBaBs(params),
  ])

  const sections: ExportSection[] = [
    {
      title: "KDV Özeti",
      sheetName: "KDV Özeti",
      columns: [
        { key: "label", label: "Kalem", width: 80 },
        { key: "amount", label: "Tutar", type: "money", width: 45 },
      ],
      totals: null,
      rows: [
        { label: "Hesaplanan KDV (satışlar)", amount: vat.calculatedVAT },
        { label: "İndirilecek KDV (alışlar)", amount: vat.deductibleVAT },
        {
          label: vat.netVAT >= 0 ? "ÖDENECEK KDV" : "DEVREDEN KDV",
          amount: Math.abs(vat.netVAT),
        },
      ],
    },
    {
      title: "KDV — Satış Kırılımı",
      sheetName: "KDV Satış",
      columns: VAT_BREAKDOWN_COLUMNS,
      rows: vat.breakdown.sales,
    },
    {
      title: "KDV — Alış Kırılımı",
      sheetName: "KDV Alış",
      columns: VAT_BREAKDOWN_COLUMNS,
      rows: vat.breakdown.purchases,
    },
    {
      title: "Muhtasar — Stopaja Konu Ödemeler",
      sheetName: "Muhtasar",
      columns: [
        { key: "date", label: "Tarih", type: "date", width: 26 },
        { key: "supplierName", label: "Tedarikçi" },
        { key: "description", label: "Açıklama", width: 60 },
        { key: "amount", label: "Ödeme", type: "money", width: 32, total: true },
        { key: "withholding", label: "Stopaj (%15)", type: "money", width: 32, total: true },
      ],
      rows: withholding.payments.map((payment) => ({
        date: payment.date,
        supplierName: payment.supplier?.name ?? "",
        description: payment.description ?? "",
        amount: payment.amount,
        withholding: payment.amount * 0.15,
      })),
    },
    {
      title: `Ba-Bs — Satışlar (${baBs.sales.count} fatura)`,
      sheetName: "Bs Satışlar",
      columns: BABS_COLUMNS,
      rows: baBs.sales.invoices.map((invoice) => ({
        date: invoice.date,
        invoiceNo: invoice.invoiceNo,
        counterpartyName: invoice.counterparty?.name ?? "",
        counterpartyTaxNumber: invoice.counterparty?.taxNumber ?? "",
        netAmount: invoice.netAmount,
        vatAmount: invoice.vatAmount,
        totalAmount: invoice.totalAmount,
      })),
    },
    {
      title: `Ba-Bs — Alışlar (${baBs.purchases.count} fatura)`,
      sheetName: "Ba Alışlar",
      columns: BABS_COLUMNS,
      rows: baBs.purchases.invoices.map((invoice) => ({
        date: invoice.date,
        invoiceNo: invoice.invoiceNo,
        counterpartyName: invoice.counterparty?.name ?? "",
        counterpartyTaxNumber: invoice.counterparty?.taxNumber ?? "",
        netAmount: invoice.netAmount,
        vatAmount: invoice.vatAmount,
        totalAmount: invoice.totalAmount,
      })),
    },
  ]

  return {
    title: "Vergi Beyanname Raporu",
    company,
    filters: describeFilters([
      ["Dönem", `${MONTHS[params.month - 1] ?? params.month} ${params.year}`],
    ]),
    sections,
    generatedAt: new Date(),
  }
}
