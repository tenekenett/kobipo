/**
 * Fatura listesi dışa aktarımı — gelen + giden.
 *
 * `lib/faturalar/list-query.ts` üzerinden çalışır; ekran ile aynı birleştirme,
 * aynı filtreler. Fark yalnızca satır tavanında: ekran kaynak başına 500 satır
 * gösterirken dışa aktarma 10.000'e çıkar, tavan yine dolarsa kullanıcıya
 * belgenin üstünde uyarı yazılır (sessizce eksik dosya vermek en kötüsü).
 */

import { fetchInvoiceList } from "@/lib/faturalar/list-query"
import { parseTrNumber } from "@/lib/format"
import type { ExportColumn, ExportDataset } from "../types"
import { loadExportCompany, describeDateRange, describeFilters } from "./context"

const EXPORT_ROW_LIMIT = 10000

export type InvoiceExportParams = {
  companyId: string
  direction?: string | null
  includeInbox?: string | null
  days?: string | null
  startDate?: string | null
  endDate?: string | null
  status?: string | null
  search?: string | null
  category?: string | null
  counterparty?: string | null
  taxNumber?: string | null
  minAmount?: string | null
  maxAmount?: string | null
}

const COLUMNS: ExportColumn[] = [
  { key: "date", label: "Tarih", type: "date", width: 22 },
  { key: "directionLabel", label: "Yön", width: 18, align: "center" },
  { key: "invoiceNo", label: "Fatura No", width: 32 },
  { key: "counterpartyName", label: "Karşı Taraf" },
  { key: "counterpartyTaxNumber", label: "VKN/TCKN", width: 26 },
  { key: "invoiceTypeLabel", label: "Belge Tipi", width: 24 },
  { key: "statusLabel", label: "Durum", width: 22 },
  { key: "category", label: "Kategori", width: 24 },
  { key: "currency", label: "Döviz", width: 14, align: "center" },
  { key: "netAmount", label: "Matrah", type: "money", width: 24, total: true },
  { key: "vatAmount", label: "KDV", type: "money", width: 22, total: true },
  { key: "totalAmount", label: "Genel Toplam", type: "money", width: 26, total: true },
]

const INVOICE_TYPE_LABELS: Record<string, string> = {
  E_INVOICE: "E-Fatura",
  E_ARCHIVE: "E-Arşiv",
  SATIS: "Satış",
  TEVKIFAT: "Tevkifat",
  IADE: "İade",
  ISTISNA: "İstisna",
  OZELMATRAH: "Özel Matrah",
  IHRACAT: "İhracat",
}

/**
 * Ekrandaki rozetle aynı okuma. Alış faturası ALINAN bir belgedir, taslak/onay
 * akışı yoktur → DRAFT'ı "Taslak" değil "Kayıtlı" göster (faturalar-listing.tsx
 * ile birebir aynı kural).
 */
function statusLabel(status: string | null, source: string): string {
  if (!status) return ""
  if (status === "DRAFT" && (source === "manual_purchase" || source === "converted_inbox")) return "Kayıtlı"
  if (status === "GIB_DRAFT") return "GİB Taslağı"
  return status
}

export async function buildInvoicesDataset(params: InvoiceExportParams): Promise<ExportDataset> {
  const direction =
    params.direction === "incoming" || params.direction === "outgoing" ? params.direction : "all"

  const [company, result] = await Promise.all([
    loadExportCompany(params.companyId),
    fetchInvoiceList({
      companyId: params.companyId,
      direction,
      includeInbox: params.includeInbox === null || params.includeInbox === undefined
        ? true
        : params.includeInbox !== "false",
      days: Number(params.days || "90"),
      startDate: params.startDate,
      endDate: params.endDate,
      status: params.status,
      search: params.search,
      // Detaylı filtreler ekranla AYNI sorguya gider; kategori de artık burada
      // süzülüyor (önce listede JS ile süzülüyordu, satır tavanı kategoriden ÖNCE
      // uygulandığı için kesilme farklı yerde oluyordu).
      counterparty: params.counterparty,
      taxNumber: params.taxNumber,
      category: params.category,
      minAmount: parseTrNumber(params.minAmount ?? null),
      maxAmount: parseTrNumber(params.maxAmount ?? null),
      limit: EXPORT_ROW_LIMIT,
    }),
  ])

  const rows = result.data.map((row) => ({
    date: row.date,
    directionLabel: row.direction === "incoming" ? "Gelen" : "Giden",
    invoiceNo: row.invoiceNo,
    counterpartyName: row.counterparty.name,
    counterpartyTaxNumber: row.counterparty.taxNumber,
    invoiceTypeLabel: row.invoiceType ? INVOICE_TYPE_LABELS[row.invoiceType] ?? row.invoiceType : "",
    statusLabel: statusLabel(row.status, row.source),
    category: row.category ?? "",
    currency: row.currency,
    netAmount: row.netAmount,
    vatAmount: row.vatAmount,
    totalAmount: row.totalAmount,
  }))

  const title =
    direction === "incoming" ? "Gelen Faturalar" : direction === "outgoing" ? "Giden Faturalar" : "Faturalar"

  return {
    title,
    company,
    filters: describeFilters([
      ["Dönem", describeDateRange(result.dateRange.startDate, result.dateRange.endDate)],
      ["Yön", direction === "all" ? "Tümü" : direction === "incoming" ? "Gelen" : "Giden"],
      ["Durum", params.status],
      ["Kategori", params.category],
      ["Karşı taraf", params.counterparty],
      ["VKN/TCKN", params.taxNumber],
      ["Tutar (min)", params.minAmount],
      ["Tutar (max)", params.maxAmount],
      ["Arama", params.search],
    ]),
    sections: [{ title, sheetName: "Faturalar", columns: COLUMNS, rows }],
    note: result.truncated
      ? `Kayıt sayısı dışa aktarma sınırına (kaynak başına ${EXPORT_ROW_LIMIT.toLocaleString("tr-TR")} satır) ulaştı. Listenin tamamı için tarih aralığını daraltın.`
      : null,
    generatedAt: new Date(),
  }
}
