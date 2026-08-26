import type { Content, TDocumentDefinitions } from "pdfmake/interfaces"
import { docTable, type Column } from "@/lib/pdf/doc/items-table"
import { buildDocDefinition, renderPdf, CONTENT_WIDTH } from "@/lib/pdf/doc/page-frame"
import { softBreak } from "@/lib/pdf/doc/safe-text"
import { COLORS, FS, mm } from "@/lib/pdf/doc/theme"
// Rakam → yazı tek kaynakta: lib/format.ts (fatura NOTLARI da
// aynı metni kullanıyor; o yol pdfmake yüklemesin diye modül dışarı alındı).
import { amountInWords } from "@/lib/format"

export { amountInWords }

/**
 * GİB düzeninde (taslak) fatura PDF'i.
 *
 * Dışa açık API korunur — `generateGibInvoicePdfBuffer(data)` — yalnız çizim
 * motoru değişti: jsPDF + mutlak mm koordinatları yerine akış tabanlı pdfmake.
 * Eski sürümde her blok kendi y imlecini elle taşıyordu (`partyY = max(leftY,
 * infoY) + 4`, `notesY = max(ty, ...) + 8`); uzun bir unvan ya da adres bu
 * hesapları kaydırıp blokları üst üste bindiriyordu. Yerleşim regresyonu:
 * `lib/pdf/doc/gib-invoice-fuzz.test.ts`.
 */

export type GibDocKind = "E_INVOICE" | "E_ARCHIVE" | "MANUAL"

export interface GibInvoiceParty {
  name: string
  taxNumber?: string | null
  taxOffice?: string | null
  address?: string | null
  district?: string | null
  city?: string | null
  phone?: string | null
  email?: string | null
}

export interface GibInvoiceLine {
  description: string
  /** Satır açıklaması — mal/hizmet adının altına ikinci satır olarak basılır. */
  note?: string | null
  quantity: number
  unit?: string | null
  unitPrice: number
  discountAmount: number
  discountRate?: number | null
  vatRate: number
  vatAmount: number
  /** KDV tevkifat oranı (KDV'nin yüzdesi, ör. 50). Varsa satırda gösterilir. */
  withholdingRate?: number | null
  /** Mal Hizmet Tutarı — iskonto sonrası, KDV hariç satır neti */
  lineNet: number
}

export interface GibInvoiceTotals {
  /** Mal Hizmet Toplam Tutarı — satırların brüt (miktar×fiyat) toplamı */
  grossTotal: number
  /** Satır iskontoları toplamı */
  lineDiscountTotal: number
  /** Fatura altı (genel) iskonto */
  globalDiscount: number
  /** Fatura altı ilave (masraf) — KDV matrahına dahildir. */
  globalCharge?: number
  /** Dip toplam yuvarlaması — KDV'ye girmez, ödenecek tutara eklenir. */
  rounding?: number
  /** Mal/hizmet net tutarı (iskontolar düşülmüş, ÖTV/GEKAP hariç) */
  netAmount: number
  /**
   * KDV'nin fiilen hesaplandığı matrah: net + ÖTV + GEKAP. Verilmezse netAmount
   * varsayılır (ÖTV/GEKAP'sız faturada ikisi zaten aynıdır).
   */
  vatBaseAmount?: number
  /** Hesaplanan KDV */
  vatAmount: number
  /** KDV Tevkifatı (varsa) */
  withholdingAmount: number
  /** ÖTV (varsa) — matraha eklenir */
  exciseAmount: number
  /** Diğer vergiler — ör. Konaklama Vergisi (varsa) */
  otherTaxAmount: number
  /** Diğer verginin matraha GİREN kısmı (oransal GEKAP); otherTaxAmount'ın alt kümesi. */
  otherTaxInBaseAmount?: number
  /** Maktu GEKAP (₺/birim × miktar) — matraha eklenir, iskontodan etkilenmez. */
  gekapAmount?: number
  otherTaxLabel?: string | null
  /** Ödenecek Tutar (vergiler dahil, tevkifat düşülmüş) */
  totalAmount: number
}

export interface GibInvoiceData {
  invoiceNo: string
  ettn?: string | null
  date: string
  dueDate?: string | null
  /** SALES | PURCHASE | RETURN */
  type: string
  invoiceType: GibDocKind
  currency?: string
  company: GibInvoiceParty
  counterparty?: GibInvoiceParty | null
  items: GibInvoiceLine[]
  totals: GibInvoiceTotals
  notes?: string | null
  /** true (varsayılan) ise "TASLAK" filigranı ve uyarı bandı çizilir. */
  isDraft?: boolean
}

const BRAND = "#143d6b"
const MUTED = "#6e6e6e"
const LINE = "#d2d6dc"

function fmt(n: unknown): string {
  return (Number(n) || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "-"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("tr-TR")
}

function scenarioLabel(t: GibDocKind): string {
  if (t === "E_INVOICE") return "TICARIFATURA"
  if (t === "E_ARCHIVE") return "EARSIVFATURA"
  return "-"
}

function docTitle(t: GibDocKind): string {
  if (t === "E_INVOICE") return "e-FATURA"
  if (t === "E_ARCHIVE") return "e-ARŞİV FATURA"
  return "FATURA"
}

/** Taraf künyesi satırları (GİB düzeninde VD ve VKN aynı satırda). */
function partyLines(p: GibInvoiceParty): string[] {
  const lines: string[] = []
  if (p.taxOffice || p.taxNumber) {
    lines.push(`${p.taxOffice ? `${p.taxOffice} VD - ` : ""}VKN/TCKN: ${p.taxNumber || "-"}`)
  }
  if (p.address) lines.push(p.address)
  const loc = [p.district, p.city].filter(Boolean).join(" / ")
  if (loc) lines.push(loc)
  if (p.phone) lines.push(`Tel: ${p.phone}`)
  if (p.email) lines.push(`E-Posta: ${p.email}`)
  return lines
}

/** Sağ üstteki belge bilgi kutusu (başlık şeridi + etiket/değer satırları). */
function infoBox(data: GibInvoiceData, isDraft: boolean, width: number): Content {
  const rows: Array<[string, string]> = [
    ["Senaryo", scenarioLabel(data.invoiceType)],
    ["Fatura Tipi", data.type === "RETURN" ? "IADE" : "SATIS"],
    ["Fatura No", data.invoiceNo || "(otomatik atanacak)"],
    ["Fatura Tarihi", fmtDate(data.date)],
  ]
  if (data.dueDate) rows.push(["Vade Tarihi", fmtDate(data.dueDate)])
  rows.push(["ETTN", data.ettn || (isDraft ? "(taslak — henüz yok)" : "-")])

  return {
    table: {
      widths: ["auto", "*"],
      body: [
        [
          {
            text: docTitle(data.invoiceType),
            colSpan: 2,
            alignment: "center",
            bold: true,
            fontSize: FS.h1,
            color: "#ffffff",
            fillColor: BRAND,
            margin: [mm(1), mm(1.4), mm(1), mm(1.4)],
          },
          {},
        ],
        ...rows.map(([label, value], i) => [
          {
            text: label,
            bold: true,
            fontSize: FS.tiny,
            color: MUTED,
            fillColor: i % 2 === 1 ? "#f4f6f9" : undefined,
            margin: [mm(1.2), mm(1), mm(1), mm(1)] as [number, number, number, number],
          },
          {
            text: softBreak(value),
            alignment: "right" as const,
            fontSize: FS.tiny,
            fillColor: i % 2 === 1 ? "#f4f6f9" : undefined,
            margin: [mm(1), mm(1), mm(1.2), mm(1)] as [number, number, number, number],
          },
        ]),
      ],
    },
    layout: {
      hLineWidth: () => 0.3,
      vLineWidth: () => 0.3,
      hLineColor: () => LINE,
      vLineColor: () => LINE,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
    width,
  } as Content
}

/** Sağdaki dip toplam kutusu (son satır vurgulu). */
function totalsBox(data: GibInvoiceData): Content {
  const t = data.totals
  const curLabel = data.currency === "TRY" || !data.currency ? "TL" : data.currency
  const rows: Array<[string, string, boolean]> = [
    ["Mal Hizmet Toplam Tutarı", `${fmt(t.grossTotal)} ${curLabel}`, false],
  ]
  const discountTotal = (t.lineDiscountTotal || 0) + (t.globalDiscount || 0)
  if (discountTotal > 0) rows.push(["Toplam İskonto", `${fmt(discountTotal)} ${curLabel}`, false])
  if ((t.globalCharge || 0) > 0)
    rows.push(["Fatura Altı İlave", `${fmt(t.globalCharge || 0)} ${curLabel}`, false])

  // ÖTV ve matraha giren pay (GEKAP) mal/hizmet bedeline eklenir, KDV bu toplam
  // üzerinden hesaplanır → ikisi de "KDV Matrahı" satırından ÖNCE listelenir.
  const otherTaxInBase = t.otherTaxInBaseAmount || 0
  const otherTaxOnTop = (t.otherTaxAmount || 0) - otherTaxInBase
  const gekap = t.gekapAmount || 0
  const vatBase = t.vatBaseAmount ?? t.netAmount
  if ((t.exciseAmount || 0) > 0) rows.push(["ÖTV", `${fmt(t.exciseAmount)} ${curLabel}`, false])
  if (gekap > 0) rows.push(["GEKAP", `${fmt(gekap)} ${curLabel}`, false])
  if (otherTaxInBase > 0)
    rows.push([t.otherTaxLabel || "GEKAP", `${fmt(otherTaxInBase)} ${curLabel}`, false])
  rows.push(["KDV Matrahı", `${fmt(vatBase)} ${curLabel}`, false])
  rows.push(["Hesaplanan KDV", `${fmt(t.vatAmount)} ${curLabel}`, false])
  if (otherTaxOnTop > 0)
    rows.push([t.otherTaxLabel || "Diğer Vergiler", `${fmt(otherTaxOnTop)} ${curLabel}`, false])

  const vergilerDahil =
    t.netAmount + t.vatAmount + (t.exciseAmount || 0) + (t.otherTaxAmount || 0) + gekap
  rows.push(["Vergiler Dahil Toplam Tutar", `${fmt(vergilerDahil)} ${curLabel}`, false])

  if ((t.withholdingAmount || 0) > 0) {
    const wRate = t.vatAmount > 0 ? Math.round((t.withholdingAmount / t.vatAmount) * 100) : 0
    rows.push([
      `KDV Tevkifatı${wRate ? ` (%${wRate})` : ""}`,
      `- ${fmt(t.withholdingAmount)} ${curLabel}`,
      false,
    ])
  }
  if ((t.rounding || 0) !== 0) {
    rows.push([
      "Yuvarlama",
      `${(t.rounding || 0) > 0 ? "" : "- "}${fmt(Math.abs(t.rounding || 0))} ${curLabel}`,
      false,
    ])
  }
  rows.push(["Ödenecek Tutar", `${fmt(t.totalAmount)} ${curLabel}`, true])

  return {
    table: {
      widths: ["*", "auto"],
      body: rows.map(([label, value, emphasize]) => [
        {
          text: label,
          fontSize: emphasize ? FS.body : FS.small,
          bold: emphasize,
          color: emphasize ? "#ffffff" : MUTED,
          fillColor: emphasize ? BRAND : undefined,
          margin: [mm(1.5), mm(1), mm(1), mm(1)] as [number, number, number, number],
        },
        {
          text: softBreak(value),
          alignment: "right" as const,
          fontSize: emphasize ? FS.body : FS.small,
          bold: true,
          color: emphasize ? "#ffffff" : "#000000",
          fillColor: emphasize ? BRAND : undefined,
          margin: [mm(1), mm(1), mm(1.5), mm(1)] as [number, number, number, number],
        },
      ]),
    },
    layout: {
      hLineWidth: () => 0.3,
      vLineWidth: () => 0.3,
      hLineColor: () => LINE,
      vLineColor: () => LINE,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  }
}

function buildContent(data: GibInvoiceData, isDraft: boolean): Content[] {
  // GİB düzeninde sol üst blok belgeyi DÜZENLEYEN (satıcı), "SAYIN" kutusu ise
  // belgenin muhatabı (alıcı) taraftır. Alış faturasını tedarikçi düzenler,
  // firmamız alıcıdır — bu yüzden taraflar fatura tipine göre yer değiştirir.
  const isPurchase = data.type === "PURCHASE"
  const issuer: GibInvoiceParty = isPurchase
    ? data.counterparty || { name: "(tedarikçi seçilmedi)" }
    : data.company
  const recipient: GibInvoiceParty | null = isPurchase ? data.company : data.counterparty || null

  const content: Content[] = []

  if (isDraft) {
    content.push({
      table: {
        widths: ["*"],
        body: [
          [
            {
              text:
                "TASLAK — Bu bir ön izlemedir, mali/yasal değeri yoktur. Resmî belge, fatura " +
                "resmileştirildikten sonra GİB tarafından üretilir.",
              alignment: "center",
              bold: true,
              fontSize: FS.tiny,
              color: "#92400e",
              fillColor: "#fff7ed",
              margin: [mm(2), mm(1.6), mm(2), mm(1.6)],
            },
          ],
        ],
      },
      layout: {
        hLineWidth: () => 0.3,
        vLineWidth: () => 0.3,
        hLineColor: () => "#f59e0b",
        vLineColor: () => "#f59e0b",
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 0,
        paddingBottom: () => 0,
      },
      margin: [0, 0, 0, mm(4)],
    })
  }

  // Üst blok: solda düzenleyen künyesi, sağda belge bilgi kutusu.
  content.push({
    columns: [
      {
        width: "*",
        stack: [
          { text: softBreak(issuer.name || "-"), bold: true, fontSize: FS.h1, color: BRAND },
          ...partyLines(issuer).map((l) => ({
            text: softBreak(l),
            fontSize: FS.small,
            color: MUTED,
          })),
        ],
      },
      infoBox(data, isDraft, mm(66)),
    ],
    columnGap: mm(5),
  })

  // SAYIN (ALICI) kutusu — tam genişlik.
  content.push({
    table: {
      widths: ["*"],
      body: [
        [
          {
            stack: [
              { text: "SAYIN (ALICI)", bold: true, fontSize: FS.tiny, color: MUTED },
              {
                text: softBreak(recipient?.name || "(cari seçilmedi)"),
                fontSize: FS.h2,
                margin: [0, mm(1), 0, mm(1)],
              },
              ...(recipient
                ? partyLines(recipient).map((l) => ({
                    text: softBreak(l),
                    fontSize: FS.small,
                    color: MUTED,
                  }))
                : []),
            ],
            fillColor: "#f8f9fb",
            margin: [mm(3), mm(2), mm(3), mm(2)],
          },
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0.3,
      vLineWidth: () => 0.3,
      hLineColor: () => LINE,
      vLineColor: () => LINE,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
    margin: [0, mm(4), 0, 0],
  })

  // Kalem tablosu (GİB kolonları).
  const columns: Column<GibInvoiceLine>[] = [
    { header: "Sıra", width: 6, align: "center", cell: (_r, i) => String(i + 1) },
    {
      header: "Mal / Hizmet",
      width: 32,
      cell: (r) => r.description || "-",
      sub: (r) => (r.note && r.note.trim() ? r.note.trim() : null),
    },
    {
      header: "Miktar",
      width: 12,
      align: "right",
      cell: (r) => `${fmt(r.quantity)} ${(r.unit || "").toString()}`.trim(),
    },
    { header: "Birim Fiyat", width: 13, align: "right", cell: (r) => fmt(r.unitPrice) },
    {
      header: "İskonto",
      width: 11,
      align: "right",
      cell: (r) => (r.discountAmount > 0 ? fmt(r.discountAmount) : "-"),
    },
    {
      header: "KDV",
      width: 8,
      align: "center",
      cell: (r) => `%${Number(r.vatRate) || 0}`,
      // Tevkifat varsa oranın altına ikinci satır olarak düşer.
      sub: (r) =>
        (Number(r.withholdingRate) || 0) > 0 ? `Tevk.%${Number(r.withholdingRate)}` : null,
    },
    { header: "KDV Tutarı", width: 12, align: "right", cell: (r) => fmt(r.vatAmount) },
    { header: "Mal Hizmet Tutarı", width: 15, align: "right", cell: (r) => fmt(r.lineNet) },
  ]

  content.push({
    ...(docTable({ columns, rows: data.items, headColor: BRAND }) as any),
    margin: [0, mm(4), 0, 0],
  })

  // Yalnız (yazıyla) — solda; dip toplam kutusu sağda.
  content.push({
    columns: [
      {
        width: "*",
        text: softBreak(amountInWords(data.totals.totalAmount, data.currency)),
        bold: true,
        fontSize: FS.small,
        margin: [0, mm(1), 0, 0],
      },
      { width: mm(92), ...(totalsBox(data) as any) },
    ],
    columnGap: mm(4),
    margin: [0, mm(4), 0, 0],
  })

  if (data.notes && data.notes.trim()) {
    content.push({
      stack: [
        { text: "Notlar", bold: true, fontSize: FS.small, color: MUTED },
        { text: softBreak(data.notes.trim()), fontSize: FS.small, color: "#1e1e1e" },
      ],
      margin: [0, mm(6), 0, 0],
    })
  }

  return content
}

/**
 * GİB düzeninde fatura PDF'i üretir ve Buffer döndürür (server-side).
 */
export async function generateGibInvoicePdfBuffer(data: GibInvoiceData): Promise<Buffer> {
  const isDraft = data.isDraft !== false

  const dd: TDocumentDefinitions = buildDocDefinition({
    title: `${docTitle(data.invoiceType)} ${data.invoiceNo || ""}`.trim(),
    footerNote: isDraft
      ? `TASLAK — ${new Date().toLocaleString("tr-TR")} · Kobipo Ön Muhasebe`
      : `${new Date().toLocaleString("tr-TR")} · Kobipo Ön Muhasebe`,
    content: buildContent(data, isDraft),
  })

  if (isDraft) {
    // Filigran: motorun kendi katmanı — metin akışını etkilemez.
    dd.watermark = { text: "TASLAK", color: BRAND, opacity: 0.08, bold: true, angle: -40 }
  }

  return renderPdf(dd)
}

/** İçerik genişliği (mm) — testlerin kolon hesabı için. */
export const GIB_CONTENT_WIDTH = CONTENT_WIDTH
export { COLORS as GIB_COLORS }
