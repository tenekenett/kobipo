import type { Content } from "pdfmake/interfaces"
import { docTable, type Column } from "@/lib/pdf/doc/items-table"
import { buildDocDefinition, renderPdf, section } from "@/lib/pdf/doc/page-frame"
import { partyBox, partyHeader, type PartyLike } from "@/lib/pdf/doc/party-box"
import { totalsBlock, type TotalRow } from "@/lib/pdf/doc/totals"
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/pdf/doc/money"
import { softBreak } from "@/lib/pdf/doc/safe-text"
import { COLORS, FS, mm } from "@/lib/pdf/doc/theme"

/**
 * FATURA belgesi (Kobipo düzeni).
 *
 * Teklif belgesiyle aynı kiti kullanır: mutlak koordinat yok, her blok kendi
 * genişliğinde sarılır. Önceki jsPDF sürümünde firma adresi/şehri/telefonu
 * sarılmadan çiziliyor, müşteri kutusu 25mm sabit yükseklikte olup ad 2 satıra,
 * adres 1 satıra kırpılıyordu (`slice(0,2)` / `slice(0,1)`) — uzun içerik ya
 * kayboluyor ya da komşu bloğa biniyordu.
 */

export type FaturaPdfLine = {
  description: string
  note?: string | null
  quantity: number
  unitPrice: number
  discountAmount: number
  vatRate: number
  totalAmount: number
}

export type FaturaPdfData = {
  invoiceNo: string
  date: Date | string
  dueDate?: Date | string | null
  /** SALES | PURCHASE | RETURN */
  type: string
  /** E_INVOICE | E_ARCHIVE | MANUAL */
  invoiceType: string
  currency: string
  notes?: string | null
  /** Belge şablonu adı (standart/kurumsal/…) — başlık şerit rengini belirler. */
  template?: string
  company: PartyLike
  counterparty: PartyLike | null
  lines: FaturaPdfLine[]
  /** Satırların brüt toplamı (miktar × birim fiyat). */
  grossTotal: number
  lineDiscountTotal: number
  globalDiscountAmount: number
  netAmount: number
  vatAmount: number
  totalAmount: number
}

const TITLES: Record<string, string> = {
  E_INVOICE: "E-FATURA",
  E_ARCHIVE: "E-ARŞİV FATURA",
  MANUAL: "MANUEL FATURA",
}

export function buildFaturaContent(data: FaturaPdfData): Content[] {
  const cur = data.currency || "TRY"
  const isSales = data.type === "SALES"
  const headColor = data.template === "kurumsal" ? "#166534" : COLORS.headBg

  const columns: Column<FaturaPdfLine>[] = [
    { header: "#", width: 5, align: "center", cell: (_r, i) => String(i + 1) },
    {
      header: "Açıklama",
      width: 36,
      cell: (r) => r.description || "-",
      sub: (r) => (r.note && r.note.trim() ? r.note.trim() : null),
    },
    { header: "Miktar", width: 11, align: "right", cell: (r) => fmtNumber(r.quantity) },
    { header: "Birim Fiyat", width: 14, align: "right", cell: (r) => fmtMoney(r.unitPrice, cur) },
    {
      header: "İskonto",
      width: 12,
      align: "right",
      cell: (r) => (r.discountAmount > 0 ? `-${fmtMoney(r.discountAmount, cur)}` : "-"),
    },
    {
      header: "KDV",
      width: 8,
      align: "center",
      cell: (r) => `%${fmtNumber(r.vatRate).replace(",00", "")}`,
    },
    { header: "Tutar", width: 14, align: "right", cell: (r) => fmtMoney(r.totalAmount, cur) },
  ]

  const meta: Content[] = [
    { text: TITLES[data.invoiceType] || "FATURA", style: "docTitle", alignment: "right" },
  ]
  if (data.template && data.template !== "standart") {
    meta.push({ text: `Şablon: ${softBreak(data.template)}`, style: "muted", alignment: "right" })
  }
  meta.push(
    { text: softBreak(`Fatura No: ${data.invoiceNo}`), alignment: "right", margin: [0, mm(1), 0, 0] },
    { text: `Tarih: ${fmtDate(data.date)}`, alignment: "right", margin: [0, mm(1), 0, 0] },
  )
  if (data.dueDate) {
    meta.push({ text: `Vade: ${fmtDate(data.dueDate)}`, alignment: "right", margin: [0, mm(1), 0, 0] })
  }
  meta.push({
    text: `Tip: ${isSales ? "Satış" : data.type === "RETURN" ? "İade" : "Alış"}`,
    alignment: "right",
    margin: [0, mm(1), 0, 0],
  })

  const totals: TotalRow[] = [{ label: "Ara Toplam", value: fmtMoney(data.grossTotal, cur) }]
  if (data.lineDiscountTotal > 0) {
    totals.push({ label: "Satır İskontoları", value: `-${fmtMoney(data.lineDiscountTotal, cur)}` })
  }
  if (data.globalDiscountAmount > 0) {
    totals.push({ label: "Fatura İskontosu", value: `-${fmtMoney(data.globalDiscountAmount, cur)}` })
  }
  totals.push(
    { label: "Matrah", value: fmtMoney(data.netAmount, cur) },
    { label: "KDV Toplam", value: fmtMoney(data.vatAmount, cur) },
    { label: "GENEL TOPLAM", value: fmtMoney(data.totalAmount, cur), emphasis: true },
  )

  const content: Content[] = [
    {
      columns: [
        { width: "*", ...(partyHeader(data.company) as any) },
        { width: mm(62), stack: meta },
      ],
      columnGap: mm(6),
    },
    section(
      null,
      partyBox(isSales ? "MÜŞTERİ BİLGİLERİ" : "TEDARİKÇİ BİLGİLERİ", data.counterparty),
      mm(6),
    ),
    section(null, docTable({ columns, rows: data.lines, headColor }), mm(5)),
    totalsBlock(totals),
  ]

  if (data.notes) {
    content.push(section("Notlar", { text: softBreak(data.notes), fontSize: FS.small }, mm(6)))
  }

  return content
}

/** Route'un çağırdığı tek giriş noktası: veri → PDF buffer. */
export function renderFaturaPdf(data: FaturaPdfData): Promise<Buffer> {
  return renderPdf(
    buildDocDefinition({
      title: `Fatura ${data.invoiceNo}`,
      footerNote: `Bu belge ${new Date().toLocaleString("tr-TR")} tarihinde oluşturulmuştur.`,
      content: buildFaturaContent(data),
    }),
  )
}
