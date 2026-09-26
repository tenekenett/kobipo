/**
 * "Kobipo Şablonu ile Dışarı Aktar" — faturalar KALEM BAZINDA, içe aktarım
 * şablonunun sütunlarıyla (alış ya da satış).
 *
 * Düz "Dışarı Aktar" (datasets/invoices.ts) fatura başına tek satır yazar; bu dosya
 * her kalemi ayrı satıra yazar ve başlıklar `sablonKolonlari`ndan gelir. Yani aynı
 * dosya düzeltilip "İçeri Aktar"a geri verilebilir, muhasebeciye de kalem dökümü
 * olarak gider. `bos=1` ile yalnız başlıklar (boş şablon) üretilir; satışta
 * `tur=ihracat` boş şablonun örneğini ihracat faturasıyla kurar.
 *
 * Hangi faturaların yazılacağına `fetchInvoiceList` karar verir — ekranın AYNI
 * sorgusu ve süzgeçleri (bkz. export katmanı kuralı: dışa aktarma kendi sorgusunu
 * yazmaz). Burada yalnız o faturaların kalemleri id ile okunur.
 */

import { prisma } from "@/lib/db/prisma"
import { fetchInvoiceList } from "@/lib/faturalar/list-query"
import { istanbulDay, parseTrNumber } from "@/lib/format"
import {
  cariEtiketi,
  faturaSablonToplami,
  sablonKolonlari,
  type SablonAlan,
  type SablonKalemi,
  type SablonTuru,
} from "@/lib/faturalar/fatura-sablon"
import type { ExportColumn, ExportColumnType, ExportDataset, ExportRow } from "../types"
import { describeDateRange, describeFilters, loadExportCompany } from "./context"

const EXPORT_ROW_LIMIT = 10000

export type FaturaSablonExportParams = {
  companyId: string
  yon: "alis" | "satis"
  empty?: boolean
  /** Yalnız boş şablonda: satışta "ihracat" örneği. */
  tur?: string | null
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

const COLUMN_TYPES: Partial<Record<SablonAlan, ExportColumnType>> = {
  date: "date",
  dueDate: "date",
  exchangeRate: "number",
  globalDiscount: "money",
  quantity: "qty",
  unitPrice: "number",
  discountRate: "percent",
  discountAmount: "money",
  vatRate: "percent",
  lineNet: "money",
  lineVat: "money",
  expectedTotal: "money",
}

function columnsFor(tur: SablonTuru): ExportColumn[] {
  return sablonKolonlari(tur).map((col) => ({
    key: col.key,
    label: col.label,
    type: COLUMN_TYPES[col.key] ?? "text",
  }))
}

const GUIDE_COLUMNS: ExportColumn[] = [
  { key: "label", label: "Sütun" },
  { key: "required", label: "Zorunlu" },
  { key: "level", label: "Kapsam" },
  { key: "hint", label: "Açıklama" },
]

const LEVEL_LABEL = { fatura: "Fatura (her satırda aynı)", kalem: "Kalem", bilgi: "Yalnız bilgi" } as const

function guideRows(tur: SablonTuru): ExportRow[] {
  const cari = cariEtiketi(tur)
  const extra: string[] = [
    `Her satır bir kalemdir. Aynı faturanın ikinci ve sonraki kalemlerinde Fatura No, ${cari} ve ` +
      "vergi no boş bırakılabilir; satır bir önceki faturaya eklenir. İçeri Aktar yalnız İLK sayfayı okur.",
  ]
  if (tur !== "alis") {
    extra.push(
      "Satış faturaları ONAYLI kayıt olarak açılır ve GİB'e GÖNDERİLMEZ — başka yerde kesilmiş faturaları " +
        "Kobipo'ya almak içindir.",
      "İhracat faturası aynı şablonla aktarılır (İşlem Yap → İhracat Faturalarını İçeri Aktar): KDV %0 olmalı, " +
        "KDV İstisna Kodu boşsa 301 yazılır, yeni müşteride Ülke zorunludur.",
    )
  }
  return [
    ...sablonKolonlari(tur).map((col) => ({
      label: col.label,
      required: col.required ? "Evet" : "",
      level: LEVEL_LABEL[col.level],
      hint: col.hint,
    })),
    ...extra.map((hint) => ({ label: "—", required: "", level: "", hint })),
  ]
}

/** Boş şablonun örnek sayfası — veri sayfasına KONMAZ ki yanlışlıkla aktarılmasın. */
function exampleRows(tur: SablonTuru): ExportRow[] {
  const d = new Date(2026, 8, 1)
  if (tur === "alis") {
    return [
      {
        invoiceNo: "ABC2026000000123",
        date: d,
        counterpartyName: "Örnek Tedarik A.Ş.",
        counterpartyTaxNumber: "1234567890",
        currency: "TRY",
        category: "Hammadde",
        productCode: "HM-001",
        description: "Un 50 kg",
        quantity: 10,
        unit: "ADET",
        unitPrice: 850,
        vatRate: 1,
      },
      { description: "Nakliye", quantity: 1, unit: "ADET", unitPrice: 250, vatRate: 20 },
    ]
  }
  if (tur === "ihracat") {
    return [
      {
        invoiceNo: "EXP2026000000045",
        date: d,
        counterpartyName: "Example GmbH",
        counterpartyTaxNumber: "DE123456789",
        country: "Almanya",
        currency: "EUR",
        exchangeRate: 38.5,
        productCode: "UR-100",
        description: "Hidrolik silindir",
        quantity: 4,
        unit: "ADET",
        unitPrice: 1200,
        vatRate: 0,
        exemptionCode: "301",
      },
      { description: "Montaj hizmeti", quantity: 1, unit: "ADET", unitPrice: 300, vatRate: 0, exemptionCode: "302" },
    ]
  }
  return [
    {
      invoiceNo: "SAT2026000000078",
      date: d,
      counterpartyName: "Örnek Müşteri Ltd. Şti.",
      counterpartyTaxNumber: "9876543210",
      currency: "TRY",
      category: "Toptan",
      productCode: "UR-100",
      description: "Hidrolik silindir",
      quantity: 2,
      unit: "ADET",
      unitPrice: 4500,
      vatRate: 20,
    },
    { description: "Kargo", quantity: 1, unit: "ADET", unitPrice: 150, vatRate: 20 },
  ]
}

/**
 * Hücreye yazılacak gün. Excel üreticisi tarihi sunucunun YEREL bileşenleriyle
 * seri numarasına çevirir; fatura günü ise mükellefin günüdür (Europe/Istanbul).
 * Geri yüklenecek bir dosyada bir günlük kayma kabul edilemez — gün İstanbul'a
 * göre okunur ve yerel gece yarısı olarak verilir, sunucu hangi dilimde olursa olsun.
 */
function invoiceDay(value: Date | null | undefined): Date | null {
  if (!value) return null
  const [y, m, d] = istanbulDay(value).split("-").map(Number)
  return new Date(y, m - 1, d)
}

const r2 = (n: number) => Math.round(n * 100) / 100

export async function buildFaturaSablonDataset(params: FaturaSablonExportParams): Promise<ExportDataset> {
  const company = await loadExportCompany(params.companyId)
  const alis = params.yon === "alis"
  // Satış ile ihracat AYNI sütunları kullanır; tür yalnız boş şablonun örneğini seçer.
  const tur: SablonTuru = alis ? "alis" : params.tur === "ihracat" ? "ihracat" : "satis"
  const columns = columnsFor(tur)
  const sheetName = alis ? "Alış Faturaları" : "Satış Faturaları"
  const guide = { title: "Açıklama", sheetName: "Açıklama", columns: GUIDE_COLUMNS, rows: guideRows(tur), totals: null }

  if (params.empty) {
    return {
      title: alis ? "Alış Faturası Şablonu" : tur === "ihracat" ? "İhracat Faturası Şablonu" : "Satış Faturası Şablonu",
      company,
      sections: [
        { title: sheetName, sheetName, columns, rows: [], totals: null },
        guide,
        { title: "Örnek", sheetName: "Örnek", columns, rows: exampleRows(tur), totals: null },
      ],
      generatedAt: new Date(),
    }
  }

  const result = await fetchInvoiceList({
    companyId: params.companyId,
    direction: alis ? "incoming" : "outgoing",
    includeInbox: false,
    days: Number(params.days || "90"),
    startDate: params.startDate,
    endDate: params.endDate,
    status: params.status,
    search: params.search,
    counterparty: params.counterparty,
    taxNumber: params.taxNumber,
    category: params.category,
    minAmount: parseTrNumber(params.minAmount ?? null),
    maxAmount: parseTrNumber(params.maxAmount ?? null),
    limit: EXPORT_ROW_LIMIT,
  })

  // Satış listesi iade faturalarını da taşır; iade bir satış faturası olarak geri
  // yüklenemez (yönü ve atfı var) — şablona alınmaz ve dosyada sayısı yazar.
  const listRows = result.data.filter(
    (row) => row.id.startsWith("invoice:") && (alis || row.source === "manual_sales"),
  )
  const returnsSkipped = alis ? 0 : result.data.filter((row) => row.source === "manual_return").length
  const ids = listRows.map((row) => row.id.slice("invoice:".length))

  const details = new Map<string, Awaited<ReturnType<typeof loadDetails>>[number]>()
  for (let i = 0; i < ids.length; i += 1000) {
    for (const inv of await loadDetails(params.companyId, ids.slice(i, i + 1000))) details.set(inv.id, inv)
  }

  const rows: ExportRow[] = []
  let notCarried = 0
  let codeless = 0
  for (const listRow of listRows) {
    const inv = details.get(listRow.id.slice("invoice:".length))
    if (!inv) continue
    const cari = alis ? inv.supplier : inv.customer
    const header = {
      // Satışta GİB belge numarası (ekranda görünen) — iç numara SAT-… yalnız
      // e-belge kesilmemişse yazılır. İçe aktarım ikisine de bakarak mükerrer arar.
      invoiceNo: alis ? inv.invoiceNo : inv.eDocumentNo || inv.invoiceNo,
      date: invoiceDay(inv.date),
      dueDate: invoiceDay(inv.dueDate),
      counterpartyName: cari?.name ?? "",
      counterpartyTaxNumber: cari?.taxNumber ?? "",
      country: alis ? null : inv.customer?.country ?? "",
      currency: inv.currency || "TRY",
      exchangeRate: inv.currency && inv.currency !== "TRY" && inv.exchangeRate ? Number(inv.exchangeRate) : null,
      category: inv.category ?? "",
      notes: inv.notes ?? "",
      globalDiscount: Number(inv.globalDiscountAmount ?? 0) || null,
      expectedTotal: Number(inv.totalAmount),
      ettn: alis ? (listRow.meta?.inboxUuid as string | null) ?? "" : inv.uuid ?? "",
    }

    // Geri yüklemede yazılacak kalemler — içe aktarmanın okuyacağı değerlerin AYNISI.
    const templateLines: SablonKalemi[] = []
    for (const item of inv.items) {
      const quantity = Number(item.quantity)
      const unitPrice = Number(item.unitPrice)
      const discountAmount = Number(item.discountAmount ?? 0)
      const discountRate = item.discountRate != null ? Number(item.discountRate) : 0
      if (item.productId && !item.product?.code) codeless++
      // Adı boş ama karta bağlı kalem: kartın adı yazılır, yoksa geri yüklemede satır
      // "Ürün/Hizmet Adı boş" diye reddedilirdi (kart kodsuzsa kod da yazılamıyor).
      const description = item.description || item.product?.name || ""
      templateLines.push({
        row: 0,
        productCode: "",
        description,
        quantity,
        unit: "",
        unitPrice,
        discountMode: discountRate > 0 || !(discountAmount > 0) ? "PERCENT" : "AMOUNT",
        discountRate: discountRate > 0 ? discountRate : 0,
        discountAmount: discountRate > 0 ? 0 : discountAmount,
        vatRate: Number(item.vatRate),
        exemptionCode: "",
      })
      rows.push({
        ...header,
        productCode: item.product?.code ?? "",
        description,
        quantity,
        unit: item.unit || "ADET",
        unitPrice,
        discountRate: discountRate > 0 ? discountRate : null,
        discountAmount: discountAmount > 0 ? discountAmount : null,
        vatRate: Number(item.vatRate),
        exemptionCode: alis ? null : item.taxExemptionReasonCode ?? "",
        lineNet: r2(quantity * unitPrice - discountAmount),
        lineVat: Number(item.vatAmount ?? 0),
      })
    }
    // Tahmin değil ÖLÇÜ: içe aktarma bu faturayı "Genel Toplam tutmadı" diye
    // reddedecek mi? Aynı fonksiyonla hesaplanır (tevkifat/ÖTV/GEKAP/ilave ve
    // kuruş kuralından önce yazılmış eski toplamların hepsini yakalar).
    const reimported = faturaSablonToplami({ lines: templateLines, globalDiscount: Number(header.globalDiscount ?? 0) })
    if (Math.abs(reimported.total - header.expectedTotal) > 0.01) notCarried++
  }

  const notes: string[] = []
  if (result.truncated) {
    notes.push(
      `Fatura sayısı dışa aktarma sınırına (${EXPORT_ROW_LIMIT.toLocaleString("tr-TR")}) ulaştı; tarih aralığını daraltın.`,
    )
  }
  if (returnsSkipped > 0) {
    notes.push(`${returnsSkipped} iade faturası şablona alınmadı (iade, satış faturası olarak geri yüklenemez).`)
  }
  if (notCarried > 0) {
    notes.push(
      `${notCarried} faturanın Genel Toplamı kalemlerden hesaplanan tutardan farklı (şablonun taşımadığı tevkifat, ` +
        `ÖTV, diğer vergi, GEKAP, fatura altı ilave ya da kaynak belgenin kuruş yuvarlaması). Genel Toplam belgedeki ` +
        `tutardır; bu faturalar İçeri Aktar'da toplam tutmadığı için reddedilir.`,
    )
  }
  if (codeless > 0) {
    notes.push(
      `${codeless} kalem kodu olmayan bir stok kartına bağlı; Ürün/Hizmet Kodu boş yazıldı. Geri yüklemede bu kalemler ` +
        `stok kartına bağlanmaz — önce kartlara kod verin.`,
    )
  }

  return {
    title: `${sheetName} (Kobipo Şablonu)`,
    company,
    filters: describeFilters([
      ["Dönem", describeDateRange(result.dateRange.startDate, result.dateRange.endDate)],
      ["Durum", params.status],
      ["Kategori", params.category],
      ["Karşı taraf", params.counterparty],
      ["VKN/TCKN", params.taxNumber],
      ["Tutar (min)", params.minAmount],
      ["Tutar (max)", params.maxAmount],
      ["Arama", params.search],
    ]),
    sections: [{ title: sheetName, sheetName, columns, rows, totals: null }, guide],
    note: notes.length > 0 ? notes.join(" ") : null,
    generatedAt: new Date(),
  }
}

function loadDetails(companyId: string, ids: string[]) {
  return prisma.invoice.findMany({
    where: { companyId, id: { in: ids } },
    select: {
      id: true,
      invoiceNo: true,
      eDocumentNo: true,
      uuid: true,
      date: true,
      dueDate: true,
      currency: true,
      exchangeRate: true,
      category: true,
      notes: true,
      globalDiscountAmount: true,
      totalAmount: true,
      supplier: { select: { name: true, taxNumber: true } },
      customer: { select: { name: true, taxNumber: true, country: true } },
      items: {
        orderBy: { order: "asc" },
        select: {
          productId: true,
          description: true,
          quantity: true,
          unit: true,
          unitPrice: true,
          discountRate: true,
          discountAmount: true,
          vatRate: true,
          vatAmount: true,
          taxExemptionReasonCode: true,
          product: { select: { code: true, name: true } },
        },
      },
    },
  })
}
