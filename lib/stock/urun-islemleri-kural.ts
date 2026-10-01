/**
 * Ürün kartındaki "Ürüne Ait Son 100 İşlem" — SAF kurallar (sorgu:
 * `urun-islemleri.ts`; ekran ve Excel/PDF aynı satırları okur).
 *
 * Stok Hareketleri tablosundan FARKI: o tablo stok hareketinden kurulur; hizmeti,
 * "stok girişi yapılmasın" işaretli alışı ve reçeteli ürünü göremez, cari ve
 * ödeme bilgisi taşımaz. Bu liste BELGE satırından kurulur: "bu ürün hangi
 * belgede, kime/kimden, kaça, nasıl ödenerek geçti".
 *
 * Kaynaklar:
 *  - Fatura satırı (satış, alış, iki yönde iade, fiş). Faturaya DÖNÜŞMÜŞ fiş
 *    (CONVERTED) alınmaz: kalemi birleşik faturada zaten satırdır, iki kez görünürdü.
 *    İptal ve kesilmemiş e-belge taslağı listede KALIR ama etiketlenir — geçmiştir.
 *  - Faturaya BAĞLANMAMIŞ irsaliye satırı. Bağlı irsaliye ayrı satır açmaz;
 *    numarası faturanın "İrsaliye No" sütununa yazılır.
 */

import { kaydedildigindeKesinlesir } from "@/lib/invoice/status-label"
import { isPurchaseReturn, isSalesReturn } from "@/lib/cari/invoice-direction"
import { paymentMethodLabel } from "@/lib/finans/account-types"

export type ProductTransactionRow = {
  /** Satır kimliği: `fatura:<kalem id>` ya da `irsaliye:<kalem id>`. */
  key: string
  source: "INVOICE" | "WAYBILL"
  typeLabel: string
  /** Malın yönü: IN = bize girdi (alış, satış iadesi), OUT = çıktı. */
  direction: "IN" | "OUT"
  documentId: string
  /** Fiş mi — belge linki fiş sayfasına gitsin. */
  isReceipt: boolean
  /** İrsaliye satırında hangi irsaliye listesi (SALES/PURCHASE). */
  waybillType: string | null
  documentNo: string
  /** e-Belge (GİB) numarası; yoksa boş. */
  eDocumentNo: string
  date: string
  counterpartyKind: "customer" | "supplier" | null
  /** Cari kartının adresi (slug ya da id); carisiz belgede null. */
  counterpartyRef: string | null
  counterpartyName: string
  /** Faturaya bağlı irsaliye numaraları ("İ-1, İ-2"); irsaliye satırında kendi numarası. */
  waybillNos: string
  /** Sevk tarihi: irsaliyenin teslim (yoksa düzenleme) tarihi; irsaliyesiz faturada null. */
  shipmentDate: string | null
  /** "Açık Hesap" | yöntem(ler) | "Kısmi · …"; irsaliyede boş. */
  paymentLabel: string
  /** İptal / Taslak gibi uyarı etiketi; olağan belgede boş. */
  statusTag: string
  quantity: number
  unit: string
  /** KDV dahil birim = satır toplamı ÷ miktar (iskonto düşülmüş). İrsaliyede null. */
  unitPriceGross: number | null
  /** KDV dahil satır toplamı. İrsaliyede null. */
  totalGross: number | null
  currency: string
}

export type InvoiceLineSource = {
  id: string
  quantity: number
  unit: string
  totalAmount: number
  invoice: {
    id: string
    invoiceNo: string
    eDocumentNo: string | null
    date: Date
    type: string
    returnKind: string | null
    invoiceType: string | null
    isReceipt: boolean
    status: string
    currency: string | null
    totalAmount: number
    customer: { id: string; slug: string | null; name: string } | null
    supplier: { id: string; slug: string | null; name: string } | null
    payments: Array<{ amount: number; paymentMethod: string }>
    waybills: Array<{ waybillNo: string; date: Date; deliveryDate: Date | null }>
  }
}

export type WaybillLineSource = {
  id: string
  quantity: number
  unit: string | null
  waybill: {
    id: string
    waybillNo: string
    type: string
    status: string
    date: Date
    deliveryDate: Date | null
    customer: { id: string; slug: string | null; name: string } | null
    supplier: { id: string; slug: string | null; name: string } | null
  }
}

/** Belgenin adı yönüyle birlikte: "Satış Faturası", "Alış İadesi", "Satış Fişi"… */
export function invoiceTypeLabel(inv: { type: string; returnKind: string | null; isReceipt: boolean }): string {
  if (isSalesReturn(inv)) return "Satış İadesi"
  if (isPurchaseReturn(inv)) return "Alış İadesi"
  const purchase = String(inv.type).toUpperCase() === "PURCHASE"
  if (inv.isReceipt) return purchase ? "Alış Fişi" : "Satış Fişi"
  return purchase ? "Alış Faturası" : "Satış Faturası"
}

/** Malın yönü: alış ve satış iadesi bize GİRER. */
export function invoiceDirection(inv: { type: string; returnKind: string | null }): "IN" | "OUT" {
  if (isSalesReturn(inv)) return "IN"
  if (isPurchaseReturn(inv)) return "OUT"
  return String(inv.type).toUpperCase() === "PURCHASE" ? "IN" : "OUT"
}

/**
 * Ödeme tipi: belgeye bağlı ödemelerden. Hiç ödeme yoksa "Açık Hesap"
 * (vadeli/cariye borç); tam ödenmişse yöntem(ler); eksikse "Kısmi · yöntem".
 */
export function paymentLabelOf(total: number, payments: Array<{ amount: number; paymentMethod: string }>): string {
  if (payments.length === 0) return "Açık Hesap"
  const paid = payments.reduce((sum, p) => sum + p.amount, 0)
  const methods = Array.from(new Set(payments.map((p) => paymentMethodLabel(p.paymentMethod)))).join(", ")
  return paid + 0.01 >= Math.abs(total) ? methods : `Kısmi · ${methods}`
}

/** Uyarı etiketi: iptal ya da kesilmemiş e-belge taslağı. Olağan belgede "". */
export function invoiceStatusTag(inv: {
  status: string
  type: string
  invoiceType: string | null
}): string {
  const status = String(inv.status).toUpperCase()
  if (status === "CANCELLED") return "İptal"
  if (status === "REJECTED" || status === "RED") return "Reddedildi"
  const isPurchase = String(inv.type).toUpperCase() === "PURCHASE"
  if ((status === "DRAFT" || status === "GIB_DRAFT") && !kaydedildigindeKesinlesir({ isPurchase, invoiceType: inv.invoiceType })) {
    return "Taslak"
  }
  return ""
}

const partyOf = (doc: {
  customer: { id: string; slug: string | null; name: string } | null
  supplier: { id: string; slug: string | null; name: string } | null
}) => {
  if (doc.customer) return { kind: "customer" as const, ref: doc.customer.slug || doc.customer.id, name: doc.customer.name }
  if (doc.supplier) return { kind: "supplier" as const, ref: doc.supplier.slug || doc.supplier.id, name: doc.supplier.name }
  return { kind: null, ref: null, name: "" }
}

export function invoiceLineToRow(line: InvoiceLineSource): ProductTransactionRow {
  const inv = line.invoice
  const party = partyOf(inv)
  // Birden çok irsaliye bağlıysa en GEÇ sevk görünür: mal o gün tamamlanmıştır.
  const shipment = inv.waybills
    .map((w) => (w.deliveryDate ?? w.date).getTime())
    .sort((a, b) => b - a)[0]
  return {
    key: `fatura:${line.id}`,
    source: "INVOICE",
    typeLabel: invoiceTypeLabel(inv),
    direction: invoiceDirection(inv),
    documentId: inv.id,
    isReceipt: inv.isReceipt,
    waybillType: null,
    documentNo: inv.invoiceNo,
    eDocumentNo: inv.eDocumentNo && inv.eDocumentNo !== inv.invoiceNo ? inv.eDocumentNo : "",
    date: inv.date.toISOString(),
    counterpartyKind: party.kind,
    counterpartyRef: party.ref,
    counterpartyName: party.name || (inv.isReceipt ? "Perakende" : ""),
    waybillNos: inv.waybills.map((w) => w.waybillNo).join(", "),
    shipmentDate: shipment != null ? new Date(shipment).toISOString() : null,
    paymentLabel: paymentLabelOf(inv.totalAmount, inv.payments),
    statusTag: invoiceStatusTag(inv),
    quantity: line.quantity,
    unit: line.unit,
    unitPriceGross: line.quantity !== 0 ? Math.round((line.totalAmount / line.quantity) * 10000) / 10000 : null,
    totalGross: line.totalAmount,
    currency: inv.currency || "TRY",
  }
}

export function waybillLineToRow(line: WaybillLineSource): ProductTransactionRow {
  const w = line.waybill
  const party = partyOf(w)
  const purchase = String(w.type).toUpperCase() === "PURCHASE"
  return {
    key: `irsaliye:${line.id}`,
    source: "WAYBILL",
    typeLabel: purchase ? "Alış İrsaliyesi" : "Satış İrsaliyesi",
    direction: purchase ? "IN" : "OUT",
    documentId: w.id,
    isReceipt: false,
    waybillType: w.type,
    documentNo: w.waybillNo,
    eDocumentNo: "",
    date: w.date.toISOString(),
    counterpartyKind: party.kind,
    counterpartyRef: party.ref,
    counterpartyName: party.name,
    waybillNos: w.waybillNo,
    shipmentDate: (w.deliveryDate ?? w.date).toISOString(),
    paymentLabel: "",
    statusTag: String(w.status).toUpperCase() === "CANCELLED" ? "İptal" : "",
    quantity: line.quantity,
    unit: line.unit || "",
    unitPriceGross: null,
    totalGross: null,
    currency: "TRY",
  }
}

/** İki kaynağı tarihe göre (yeniden eskiye) birleştirip ilk `limit` satırı verir. */
export function mergeTransactions(rows: ProductTransactionRow[], limit: number): ProductTransactionRow[] {
  return [...rows]
    .sort((a, b) => b.date.localeCompare(a.date) || a.documentNo.localeCompare(b.documentNo, "tr"))
    .slice(0, limit)
}

// ------------------------------------------------------------------ arama/sıra
// Ekran ve dosya AYNI fonksiyonlardan geçer: tabloda arayıp sıraladığın liste,
// indirdiğin Excel/PDF'in satırlarıdır.

export type TransactionSortKey =
  | "date"
  | "type"
  | "documentNo"
  | "party"
  | "waybill"
  | "eDocumentNo"
  | "shipment"
  | "payment"
  | "quantity"
  | "unitPrice"
  | "total"

export const TRANSACTION_SORT_KEYS: TransactionSortKey[] = [
  "date",
  "type",
  "documentNo",
  "party",
  "waybill",
  "eDocumentNo",
  "shipment",
  "payment",
  "quantity",
  "unitPrice",
  "total",
]

export function isTransactionSortKey(value: unknown): value is TransactionSortKey {
  return TRANSACTION_SORT_KEYS.includes(value as TransactionSortKey)
}

const sortValue = (row: ProductTransactionRow, key: TransactionSortKey): string | number | null => {
  switch (key) {
    case "date":
      return row.date
    case "type":
      return row.typeLabel
    case "documentNo":
      return row.documentNo
    case "party":
      return row.counterpartyName
    case "waybill":
      return row.waybillNos
    case "eDocumentNo":
      return row.eDocumentNo
    case "shipment":
      return row.shipmentDate
    case "payment":
      return row.paymentLabel
    case "quantity":
      return row.quantity
    case "unitPrice":
      return row.unitPriceGross
    case "total":
      return row.totalGross
  }
}

/**
 * Sütuna göre sıralar. Boş değer (irsaliyede fiyat, sevki olmayan fatura) yönden
 * bağımsız EN SONA gider — "en pahalı" sıralamasında başa boş satırlar dizilmesin.
 * Eşitlikte tarih (yeniden eskiye) korunur.
 */
export function sortTransactions(
  rows: ProductTransactionRow[],
  key: TransactionSortKey,
  dir: "asc" | "desc",
): ProductTransactionRow[] {
  const factor = dir === "asc" ? 1 : -1
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key)
    const vb = sortValue(b, key)
    const emptyA = va === null || va === ""
    const emptyB = vb === null || vb === ""
    if (emptyA || emptyB) {
      if (emptyA && emptyB) return b.date.localeCompare(a.date)
      return emptyA ? 1 : -1
    }
    const cmp =
      typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb), "tr", { numeric: true })
    return cmp * factor || b.date.localeCompare(a.date)
  })
}

/** Türkçe duyarsız arama: belge no, e-belge no, firma, tür, irsaliye, ödeme tipi. */
export function filterTransactions(
  rows: ProductTransactionRow[],
  matches: (...values: Array<string | null | undefined>) => boolean,
): ProductTransactionRow[] {
  return rows.filter((row) =>
    matches(row.documentNo, row.eDocumentNo, row.counterpartyName, row.typeLabel, row.waybillNos, row.paymentLabel, row.statusTag),
  )
}
