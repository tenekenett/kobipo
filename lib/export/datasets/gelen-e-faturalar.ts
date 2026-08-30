/**
 * Gelen e-fatura listesi dışa aktarımı.
 *
 * `lib/integrations/e-invoice/incoming-list-query.ts` üzerinden çalışır — ekranla
 * AYNI filtreler, AYNI sıralama. Kendi sorgusunu yazsaydı "ekranda 36 satır var ama
 * Excel'de 41" farkı doğar ve aylarca fark edilmezdi.
 *
 * Ekran 100'er sayfalıyor; burada sayfalama YOK: kullanıcı "dışa aktar" derken 1.
 * sayfayı değil, filtreye uyan listenin tamamını kastediyor. Yine de bir tavan var
 * (bkz. ROW_LIMIT) — 50.000 satırlık bir Excel'i üretmek de açmak da işkence.
 */

import { prisma } from "@/lib/db/prisma"
import {
  INCOMING_LIST_SELECT,
  buildIncomingWhere,
  describeIncomingFilters,
  incomingOrderBy,
  parseIncomingListFilters,
  resolveIncomingDateRange,
  type IncomingListFilters,
} from "@/lib/integrations/e-invoice/incoming-list-query"
import { isForeignCurrency, roundKurus, toTryAmount } from "@/lib/integrations/e-invoice/incoming-amount"
import type { ExportColumn, ExportDataset } from "../types"
import { loadExportCompany } from "./context"

const ROW_LIMIT = 20000

const PROFILE_LABELS: Record<string, string> = {
  TICARIFATURA: "Ticari",
  TEMELFATURA: "Temel",
  EARSIVFATURA: "E-Arşiv",
  EFATURA: "E-Fatura",
}

const STATUS_LABELS: Record<string, string> = {
  KABUL: "Kabul Edildi",
  RED: "Reddedildi",
}

/**
 * KOLONLAR — para birimi tuzağına dikkat.
 *
 * Satır tutarları faturanın KENDİ para birimindedir (60 USD faturası 56.928 USD
 * tutuyor). Tek bir "Tutar" kolonu koyup toplanabilir yapmak, Excel'de 318 USD'yi
 * 318 ₺ ile toplar — özet kartlarda düzeltilen hatanın aynısı. Bu yüzden belge tutarı
 * toplanmaz; toplanabilir olan YALNIZCA kur uygulanmış "Tutar (₺)" kolonudur.
 */
const COLUMNS: ExportColumn[] = [
  { key: "docDate", label: "Fatura Tarihi", type: "date", width: 24 },
  { key: "sentDate", label: "Gönderilme Tarihi", type: "datetime", width: 30 },
  { key: "invoiceNo", label: "Fatura No", width: 34 },
  { key: "senderName", label: "Gönderen Ünvanı", width: 60 },
  { key: "senderTaxNumber", label: "VKN/TCKN", width: 26 },
  { key: "profile", label: "Profil", width: 20 },
  { key: "invoiceType", label: "Tip", width: 20 },
  { key: "netAmount", label: "Net", type: "money", width: 24 },
  { key: "vatAmount", label: "KDV", type: "money", width: 22 },
  { key: "totalAmount", label: "Tutar", type: "money", width: 24 },
  { key: "currency", label: "Para Birimi", width: 18, align: "center" },
  { key: "currencyRate", label: "Kur", type: "number", width: 16 },
  { key: "totalTry", label: "Tutar (₺)", type: "money", width: 26, total: true },
  { key: "status", label: "Durum", width: 24 },
  { key: "isLinked", label: "Alışa Dönüştürüldü", type: "boolean", width: 26 },
  { key: "uuid", label: "ETTN", width: 60 },
]

export type IncomingInvoicesExportParams = {
  companyId: string
  /** Listenin query paramları — ekran filtre state'ini olduğu gibi geçirir. */
  searchParams: URLSearchParams
}

export async function buildIncomingInvoicesDataset(
  params: IncomingInvoicesExportParams,
): Promise<ExportDataset> {
  const range = resolveIncomingDateRange(params.searchParams)
  if (!range.ok) throw new Error(range.error)

  const parsed = parseIncomingListFilters(params.searchParams, range)
  if (!parsed.ok) throw new Error(parsed.error)
  const filters: IncomingListFilters = parsed.filters

  const [company, records] = await Promise.all([
    loadExportCompany(params.companyId),
    prisma.incomingInvoice.findMany({
      where: buildIncomingWhere(params.companyId, filters),
      select: INCOMING_LIST_SELECT,
      orderBy: incomingOrderBy(filters.dateField),
      take: ROW_LIMIT + 1,
    }),
  ])

  const truncated = records.length > ROW_LIMIT
  const page = truncated ? records.slice(0, ROW_LIMIT) : records

  let unconverted = 0
  let foreign = 0
  const rows = page.map((r) => {
    const { try: totalTry, converted } = toTryAmount(r.payableAmount, r.currencyRate, r.currencyCode)
    if (isForeignCurrency(r.currencyCode)) {
      foreign++
      if (!converted) unconverted++
    }
    const statusUpper = (r.status || "").toUpperCase()
    return {
      docDate: r.docDate,
      sentDate: r.sentDate,
      invoiceNo: r.invoiceNo,
      senderName: r.senderName,
      senderTaxNumber: r.senderTaxNumber,
      profile: r.profile ? (PROFILE_LABELS[r.profile] ?? r.profile) : null,
      invoiceType: r.invoiceType,
      netAmount: r.taxExclusiveAmount === null ? null : Number(r.taxExclusiveAmount),
      vatAmount: r.vatAmount === null ? null : Number(r.vatAmount),
      totalAmount: r.payableAmount === null ? null : Number(r.payableAmount),
      currency: r.currencyCode || "TRY",
      currencyRate: r.currencyRate === null ? null : Number(r.currencyRate),
      // Kuru bilinmeyen döviz faturasında toplama 0 yazmak yanlış toplam üretirdi;
      // hücre boş bırakılır ve not satırında kaç tanesi olduğu söylenir.
      totalTry: converted ? roundKurus(totalTry) : null,
      status: STATUS_LABELS[statusUpper] ?? r.status,
      isLinked: r.isLinkedToPurchase,
      uuid: r.uuid,
    }
  })

  const notes: string[] = []
  if (truncated) {
    notes.push(
      `Liste ${ROW_LIMIT.toLocaleString("tr-TR")} satırda kesildi. Tamamı için tarih aralığını daraltın.`,
    )
  }
  if (foreign > 0) {
    notes.push(
      `"Tutar (₺)" kolonu fatura kuruyla çevrilmiştir; ${foreign} döviz faturası var. ` +
        `Belge tutarı kolonu faturanın kendi para birimindedir ve TOPLANMAZ.`,
    )
  }
  if (unconverted > 0) {
    notes.push(`${unconverted} döviz faturasının kuru bilinmediği için ₺ karşılığı boş bırakıldı.`)
  }

  return {
    title: "Gelen E-Faturalar",
    company,
    filters: describeIncomingFilters(filters),
    sections: [{ columns: COLUMNS, rows }],
    orientation: "landscape",
    note: notes.length ? notes.join(" ") : null,
  }
}
