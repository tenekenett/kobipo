import type { Prisma } from "@prisma/client"
import type { CompanyLogo } from "@/lib/company/logo"
import type { PartyLike } from "@/lib/pdf/doc/party-box"
import type { FaturaPdfData } from "./fatura-document"

/**
 * KAYITLI faturadan Kobipo düzenindeki (resmî olmayan) fatura PDF'inin verisi.
 *
 * İki uç aynı belgeyi basar ve ikisi de buradan geçer: fatura önizleme sayfasının
 * "PDF İndir"/"Yazdır"ı (`/api/e-donusum/invoices/[id]/preview-pdf`) ve e-Dönüşüm
 * detay sayfası (`/api/faturalar/[id]/pdf`).
 *
 * Belgede KDV yazılmaz; tutarlar VERGİLER DAHİL gösterilir (kullanıcı kararı, 2026-10-08).
 * Çevrim kalemin KAYITLI vergilerinden yapılır, oran tahmin edilmez:
 *   satır tutarı = satır neti + satırın KDV + ÖTV + diğer vergi + GEKAP'ı;
 *   birim fiyat ve iskonto aynı oranla (tutar / net) büyür → miktar × birim − iskonto = tutar.
 * Kalem vergileri DB'de fatura altı iskonto/ilave UYGULANMADAN saklanır; başlık ise
 * uygulanmış hâldedir. Genel iskontonun vergiler dahil karşılığı bu yüzden FARKTAN bulunur
 * (kayıtlı toplam − satırlar); böylece dip toplam satırları kayıtlı `totalAmount`ı (cari
 * bakiyeye giren rakam) KURUŞU KURUŞUNA verir. Genel iskonto/ilave yoksa kalan kuruş farkı
 * (eski kayıtlar) "Yuvarlama" satırında görünür — gizlenmez.
 */

/** İki ucun faturayı okuduğu `include` — eşleyicinin beklediği şekil. */
export const FATURA_PDF_INCLUDE = {
  company: {
    select: {
      name: true,
      taxNumber: true,
      taxOffice: true,
      address: true,
      district: true,
      city: true,
      phone: true,
      email: true,
      website: true,
    },
  },
  customer: true,
  supplier: true,
  items: { orderBy: { order: "asc" } },
} satisfies Prisma.InvoiceInclude

const n = (v: unknown): number => Number(v) || 0
// `|| 0`: -0 (ör. 0,001 negatif artık) belgeye "-₺0,00" diye düşmesin.
const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100 || 0

type StoredItem = {
  description: string
  note?: string | null
  quantity: unknown
  unit?: string | null
  unitPrice: unknown
  discountAmount?: unknown
  discountRate?: unknown
  vatRate: unknown
  vatAmount?: unknown
  withholdingAmount?: unknown
  exciseAmount?: unknown
  otherTaxAmount?: unknown
  gekapAmount?: unknown
}

type StoredParty = PartyLike & { name: string }

export type StoredInvoiceForPdf = {
  invoiceNo: string
  eDocumentNo?: string | null
  date: Date
  dueDate?: Date | null
  type: string
  status: string
  currency?: string | null
  notes?: string | null
  netAmount: unknown
  vatAmount: unknown
  totalAmount: unknown
  globalDiscountAmount?: unknown
  globalChargeAmount?: unknown
  payableRoundingAmount?: unknown
  company: StoredParty
  customer?: StoredParty | null
  supplier?: StoredParty | null
  items: StoredItem[]
}

const party = (p: StoredParty): PartyLike => ({
  name: p.name,
  taxNumber: p.taxNumber,
  taxOffice: p.taxOffice,
  address: p.address,
  district: p.district,
  city: p.city,
  phone: p.phone,
  email: p.email,
  website: p.website,
})

export function faturaPdfData(invoice: StoredInvoiceForPdf, logo: CompanyLogo | null): FaturaPdfData {
  // Karşı taraf KAYITLI cariden: alışta tedarikçi, diğerlerinde müşteri (yoksa tedarikçi —
  // alış iadesi tedarikçiye kesilir; aynı cari iki rolde de olabilir).
  const counterparty =
    invoice.type === "PURCHASE" ? invoice.supplier || null : invoice.customer || invoice.supplier || null
  const counterpartyLabel =
    counterparty && counterparty === invoice.supplier ? "TEDARİKÇİ BİLGİLERİ" : "MÜŞTERİ BİLGİLERİ"

  const netAmount = n(invoice.netAmount)
  const globalDiscountAmount = n(invoice.globalDiscountAmount)
  const globalChargeAmount = n(invoice.globalChargeAmount)
  // Genel iskonto/ilave öncesi matrah → kalem tevkifatının ölçek oranı.
  const preGlobalNet = netAmount + globalDiscountAmount - globalChargeAmount
  const globalFactor = preGlobalNet > 0 ? netAmount / preGlobalNet : 1

  const lines = invoice.items.map((it) => {
    const quantity = n(it.quantity)
    const discount = n(it.discountAmount)
    const net = quantity * n(it.unitPrice) - discount
    const taxes = n(it.vatAmount) + n(it.exciseAmount) + n(it.otherTaxAmount) + n(it.gekapAmount)
    // Net'i olmayan satırda (bedelsiz kalem) oran kalemin KDV oranından.
    const ratio = net > 0 ? (net + taxes) / net : 1 + n(it.vatRate) / 100
    const lineTotal = round2(net + taxes)
    const discountAmount = round2(discount * ratio)
    const gross = round2(lineTotal + discountAmount)
    return {
      description: it.description,
      note: it.note,
      quantity,
      unit: it.unit,
      unitPrice: quantity > 0 ? gross / quantity : n(it.unitPrice) * ratio,
      discountAmount,
      discountRate: n(it.discountRate),
      lineTotal,
      gross,
    }
  })

  const linesTotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0))
  const totalAmount = n(invoice.totalAmount)
  const withholdingAmount = round2(invoice.items.reduce((s, it) => s + n(it.withholdingAmount), 0) * globalFactor)
  const storedRounding = n(invoice.payableRoundingAmount)
  const hasGlobal = globalDiscountAmount > 0.004 || globalChargeAmount > 0.004
  const globalAdjustment = hasGlobal ? round2(totalAmount + withholdingAmount - storedRounding - linesTotal) : 0

  return {
    invoiceNo: invoice.eDocumentNo || invoice.invoiceNo,
    date: invoice.date,
    dueDate: invoice.dueDate ?? null,
    type: invoice.type,
    currency: invoice.currency || "TRY",
    notes: invoice.notes,
    cancelled: invoice.status === "CANCELLED",
    company: party(invoice.company),
    counterparty: counterparty ? party(counterparty) : null,
    counterpartyLabel,
    logo,
    lines: lines.map(({ gross: _gross, ...line }) => line),
    totals: {
      grossTotal: round2(lines.reduce((s, l) => s + l.gross, 0)),
      lineDiscountTotal: round2(lines.reduce((s, l) => s + l.discountAmount, 0)),
      globalAdjustment,
      withholdingAmount,
      // Kalan: kayıtlı yuvarlama; genel iskontosuz eski kayıtta satır/başlık kuruş farkı da.
      rounding: round2(totalAmount - (linesTotal + globalAdjustment - withholdingAmount)),
      totalAmount,
    },
  }
}
