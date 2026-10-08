import type { Content } from "pdfmake/interfaces"
import type { CompanyLogo } from "@/lib/company/logo"
import { docTable, type Column } from "@/lib/pdf/doc/items-table"
import { buildDocDefinition, renderPdf, section } from "@/lib/pdf/doc/page-frame"
import { partyBox, partyHeader, type PartyLike } from "@/lib/pdf/doc/party-box"
import { totalsBlock, type TotalRow } from "@/lib/pdf/doc/totals"
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/pdf/doc/money"
import { softBreak } from "@/lib/pdf/doc/safe-text"
import { FS, mm } from "@/lib/pdf/doc/theme"

/**
 * FATURA belgesi (Kobipo düzeni) — RESMÎ OLMAYAN fatura çıktısı.
 *
 * GİB'e gitmemiş faturanın (Manuel/kâğıt fatura kaydı, gönderilmemiş e-belge taslağı,
 * alış faturası) "PDF İndir" ve "Yazdır" çıktısıdır. 2026-10-08'e kadar bu yol GİB
 * düzenini taklit ediyordu (e-ARŞİV FATURA kutusu, Senaryo/ETTN, KDV Matrahı, Ödenecek
 * Tutar, TASLAK filigranı); müşteriye verilen kâğıtta resmî belgeymiş gibi duruyordu.
 *
 * Kararlar (kullanıcı, 2026-10-08): teklif belgesi gibi; sağ üstte firma logosu (yoksa
 * Kobipo logosu); iskontolar görünür; belgede KDV YOK — ne sütun ne satır. Tutarlar
 * VERGİLER DAHİL yazılır ki satırlar toplandığında GENEL TOPLAM çıksın (KDV hariç kalem +
 * KDV dahil genel toplam, aradaki farkı açıklamadan bırakıyordu). Altlık belgenin resmî
 * olmadığını söyler. Vergiler dahil çevrim `fatura-data.ts`te.
 *
 * Resmî belge ayrıdır: GİB'e gitmiş e-belgede Mysoft'un PDF'i (`[id]/pdf`), editördeki
 * "Önizle (GİB)" ise GİB düzenindeki taslaktır (`gib-invoice-pdf.ts`).
 *
 * Teklif belgesiyle aynı kit: mutlak koordinat yok, her blok kendi genişliğinde sarılır.
 */

/** Kalem — tüm tutarlar VERGİLER DAHİL. */
export type FaturaPdfLine = {
  description: string
  note?: string | null
  quantity: number
  unit?: string | null
  unitPrice: number
  /** Satır iskontosu (tutar). */
  discountAmount: number
  /** Yüzde girilmiş iskontonun oranı; tutar girildiyse null/0. */
  discountRate?: number | null
  /** Satır tutarı: miktar × birim fiyat − satır iskontosu. */
  lineTotal: number
}

/**
 * Dip toplam kırılımı — VERGİLER DAHİL; yukarıdan aşağı toplandığında GENEL TOPLAM'ı
 * KURUŞU KURUŞUNA verir (çevrim `fatura-data.ts`, ölçüm `fatura-data.test.ts`).
 */
export type FaturaPdfTotals = {
  /** Satır iskontoları öncesi Σ satır brütü. */
  grossTotal: number
  lineDiscountTotal: number
  /** Fatura altı iskonto (−) ya da ilave (+). */
  globalAdjustment: number
  /** Tevkifat — alıcının ödemediği vergi payı (−). */
  withholdingAmount: number
  /** Kayıtlı dip toplam yuvarlaması (+ eski kayıtlarda kuruş farkı). */
  rounding: number
  /** Kayıtlı `Invoice.totalAmount` — cari bakiyeye giren tutarın kendisi. */
  totalAmount: number
}

export type FaturaPdfData = {
  invoiceNo: string
  date: Date | string
  dueDate?: Date | string | null
  /** SALES | PURCHASE | RETURN */
  type: string
  currency: string
  notes?: string | null
  /** İptal edilmiş belge: "İPTAL" filigranı basılır. */
  cancelled?: boolean
  company: PartyLike
  counterparty: PartyLike | null
  /** Karşı taraf kutusunun başlığı (MÜŞTERİ / TEDARİKÇİ BİLGİLERİ). */
  counterpartyLabel: string
  logo?: CompanyLogo | null
  lines: FaturaPdfLine[]
  totals: FaturaPdfTotals
}

/** Sağ üst kolon genişliği — teklifle aynı. */
const META_WIDTH = mm(62)
const LOGO_MAX_HEIGHT = mm(24)
/** Kobipo logosu firmanın logosu değildir; belgenin başına geçmesin diye küçük basılır. */
const KOBIPO_LOGO_MAX_WIDTH = mm(40)

// "%20", "%7,5", "%12,25" — fmtNumber hep 2 ondalık basar, sondaki sıfırlar atılır.
const pct = (n: number) => `%${fmtNumber(n).replace(/,00$/, "").replace(/(,\d)0$/, "$1")}`

export function faturaTitle(type: string): string {
  if (type === "PURCHASE") return "ALIŞ FATURASI"
  if (type === "RETURN") return "İADE FATURASI"
  return "FATURA"
}

/** Logonun basım ölçüsü: kolona ve yükseklik sınırına oranı bozulmadan sığar. */
export function logoDrawSize(logo: CompanyLogo): { width: number; height: number } {
  const w = Math.max(1, logo.pixelWidth)
  const h = Math.max(1, logo.pixelHeight)
  const maxWidth = logo.kobipo ? KOBIPO_LOGO_MAX_WIDTH : META_WIDTH
  const scale = Math.min(maxWidth / w, LOGO_MAX_HEIGHT / h)
  return { width: w * scale, height: h * scale }
}

export function buildFaturaContent(data: FaturaPdfData): Content[] {
  const cur = data.currency || "TRY"

  const columns: Column<FaturaPdfLine>[] = [
    { header: "#", width: 5, align: "center", cell: (_r, i) => String(i + 1) },
    {
      header: "Açıklama",
      width: 43,
      cell: (r) => r.description || "-",
      sub: (r) => (r.note && r.note.trim() ? r.note.trim() : null),
    },
    {
      header: "Miktar",
      width: 12,
      align: "right",
      cell: (r) => `${fmtNumber(r.quantity)} ${r.unit || ""}`.trim(),
    },
    { header: "Birim Fiyat", width: 14, align: "right", cell: (r) => fmtMoney(r.unitPrice, cur) },
    {
      header: "İskonto",
      width: 12,
      align: "right",
      cell: (r) => (r.discountAmount > 0 ? `-${fmtMoney(r.discountAmount, cur)}` : "-"),
      sub: (r) => (r.discountAmount > 0 && r.discountRate && r.discountRate > 0 ? pct(r.discountRate) : null),
    },
    { header: "Tutar", width: 14, align: "right", cell: (r) => fmtMoney(r.lineTotal, cur) },
  ]

  // Sağ üst: logo ve altında belge bilgileri — GİB düzenindeki bilgi kutusunun yeri.
  const meta: Content[] = []
  if (data.logo) {
    const size = logoDrawSize(data.logo)
    meta.push({
      image: data.logo.dataUri,
      width: size.width,
      height: size.height,
      alignment: "right",
      margin: [0, 0, 0, mm(2)],
    })
  }
  meta.push(
    { text: faturaTitle(data.type), style: "docTitle", alignment: "right" },
    { text: softBreak(`No: ${data.invoiceNo}`), alignment: "right", margin: [0, mm(1), 0, 0] },
    { text: `Tarih: ${fmtDate(data.date)}`, alignment: "right", margin: [0, mm(1), 0, 0] },
  )
  if (data.dueDate) {
    meta.push({ text: `Vade: ${fmtDate(data.dueDate)}`, alignment: "right", margin: [0, mm(1), 0, 0] })
  }
  if (cur !== "TRY") {
    meta.push({ text: `Para Birimi: ${cur}`, alignment: "right", margin: [0, mm(1), 0, 0] })
  }

  const content: Content[] = [
    {
      columns: [
        { width: "*", ...(partyHeader(data.company) as any) },
        { width: META_WIDTH, stack: meta },
      ],
      columnGap: mm(6),
    },
    section(null, partyBox(data.counterpartyLabel, data.counterparty), mm(6)),
    section(null, docTable({ columns, rows: data.lines }), mm(5)),
    totalsBlock(faturaTotalRows(data.totals, cur)),
  ]

  if (data.notes && data.notes.trim()) {
    content.push(section("Notlar", { text: softBreak(data.notes.trim()), fontSize: FS.small }, mm(6)))
  }

  return content
}

/**
 * Dip toplam satırları: ara toplam − iskontolar ± fatura altı iskonto/ilave − tevkifat ±
 * yuvarlama = GENEL TOPLAM. Sıfır olan kalem basılmaz; KDV satırı YOKTUR (tutarlar
 * vergiler dahil).
 */
export function faturaTotalRows(t: FaturaPdfTotals, cur: string): TotalRow[] {
  const money = (n: number) => fmtMoney(n, cur)
  const minus = (n: number) => `-${money(n)}`
  const nonZero = (n: number) => Math.abs(n) > 0.004

  const rows: TotalRow[] = [{ label: "Ara Toplam", value: money(t.grossTotal) }]
  const lineDiscount = nonZero(t.lineDiscountTotal)
  const globalDiscount = t.globalAdjustment < -0.004
  if (lineDiscount) {
    rows.push({ label: globalDiscount ? "Satır İskontosu" : "İskonto", value: minus(t.lineDiscountTotal) })
  }
  if (globalDiscount) {
    rows.push({ label: lineDiscount ? "Genel İskonto" : "İskonto", value: minus(-t.globalAdjustment) })
  } else if (t.globalAdjustment > 0.004) {
    rows.push({ label: "Fatura Altı İlave", value: money(t.globalAdjustment) })
  }
  if (nonZero(t.withholdingAmount)) rows.push({ label: "Tevkifat", value: minus(t.withholdingAmount) })
  if (nonZero(t.rounding)) {
    rows.push({ label: "Yuvarlama", value: t.rounding > 0 ? money(t.rounding) : minus(-t.rounding) })
  }
  rows.push({ label: "GENEL TOPLAM", value: money(t.totalAmount), emphasis: true })
  return rows
}

/** Route'un çağırdığı tek giriş noktası: veri → PDF buffer. */
export function renderFaturaPdf(data: FaturaPdfData): Promise<Buffer> {
  const dd = buildDocDefinition({
    title: `${faturaTitle(data.type)} ${data.invoiceNo}`.trim(),
    footerNote: `Bilgi amaçlıdır, resmî fatura yerine geçmez · ${new Date().toLocaleString("tr-TR")}`,
    content: buildFaturaContent(data),
  })
  if (data.cancelled) {
    // Filigran motorun kendi katmanı — metin akışını etkilemez.
    dd.watermark = { text: "İPTAL", color: "#b91c1c", opacity: 0.08, bold: true, angle: -40 }
  }
  return renderPdf(dd)
}
