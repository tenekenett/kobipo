import type { Content } from "pdfmake/interfaces"
import { docTable, type BandRow, type Column } from "@/lib/pdf/doc/items-table"
import { buildDocDefinition, renderPdf, section } from "@/lib/pdf/doc/page-frame"
import { partyBox, partyHeader, type PartyLike } from "@/lib/pdf/doc/party-box"
import { totalsBlock } from "@/lib/pdf/doc/totals"
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/pdf/doc/money"
import { softBreak } from "@/lib/pdf/doc/safe-text"
import { FS, mm } from "@/lib/pdf/doc/theme"

/**
 * TEKLİF belgesi.
 *
 * Yerleşim tamamen akış tabanlı: hiçbir metin mutlak koordinata çizilmez, her
 * blok kendi genişliğinde sarılıp bir sonrakini aşağı iter. Uzun unvan/adres,
 * çok satırlı kalem açıklaması ve uzun IBAN listesi bu yüzden kaymaya yol açmaz.
 */

export type TeklifPdfLine = {
  /**
   * BÖLÜM AYIRICI: kalemleri gruplayan başlık satırı. Fiyat kolonları yoktur,
   * tabloda kolonları birleştiren tek şerit olarak basılır. `description`
   * başlık, `note` açıklamadır; diğer alanlar okunmaz.
   */
  isSection?: boolean
  description: string
  note?: string | null
  quantity: number
  unitPrice: number
  discountAmount: number
  /** Yüzde girilmiş iskontonun oranı; tutar girildiyse null/yok. */
  discountRate?: number | null
  vatRate: number
  totalAmount: number
}

export type TeklifPdfBankAccount = {
  name: string
  bankName?: string | null
  accountNumber?: string | null
  iban?: string | null
  currency: string
}

export type TeklifPdfData = {
  quoteNo: string
  date: Date | string
  validUntil?: Date | string | null
  currency: string
  notes?: string | null
  company: PartyLike
  /** Müşteri veya (satın alma teklifinde) tedarikçi. */
  counterparty: PartyLike | null
  counterpartyLabel: string
  lines: TeklifPdfLine[]
  /** KDV matrahı: satır ve genel iskonto düşülmüş. */
  netAmount: number
  vatAmount: number
  totalAmount: number
  /** Σ satır iskontosu. */
  discountTotal: number
  /** Genel (teklif altı) iskonto tutarı. */
  globalDiscountAmount?: number
  /** Genel iskonto yüzde girildiyse oranı (etikette gösterilir). */
  globalDiscountRate?: number | null
  bankAccounts: TeklifPdfBankAccount[]
}

// "%20", "%7,5", "%12,25" — fmtNumber hep 2 ondalık basar, sondaki sıfırlar atılır.
const pct = (n: number) => `%${fmtNumber(n).replace(/,00$/, "").replace(/(,\d)0$/, "$1")}`

/**
 * Bölüm ayırıcının tablo karşılığı: kolonları birleştiren tek şerit.
 * Başlıksız bölüm (yalnız açıklama) geçerlidir — o durumda metin açıklamadan
 * gelir, yoksa belgede boş bir kalın satır kalırdı.
 */
function sectionBand(line: TeklifPdfLine): BandRow | null {
  if (!line.isSection) return null
  const title = (line.description || "").trim()
  const note = (line.note || "").trim()
  return title ? { text: title, sub: note || null } : { text: note }
}

export function buildTeklifContent(data: TeklifPdfData): Content[] {
  const cur = data.currency || "TRY"

  // Sıra numarası KALEMLERİ sayar: bölüm ayırıcı numara almaz, altındaki kalem
  // sayacı kaldığı yerden devam eder (aksi halde müşteri "3. kalem" derken
  // belgede başlığı sayardı).
  let itemNo = 0
  const rowNo = data.lines.map((line) => (line.isSection ? "" : String(++itemNo)))

  const columns: Column<TeklifPdfLine>[] = [
    { header: "#", width: 5, align: "center", cell: (_r, i) => rowNo[i] ?? "" },
    {
      header: "Açıklama",
      width: 38,
      cell: (r) => r.description || "-",
      // Satır açıklaması ürün adının altında, küçük ve soluk.
      sub: (r) => (r.note && r.note.trim() ? r.note.trim() : null),
    },
    { header: "Miktar", width: 11, align: "right", cell: (r) => fmtNumber(r.quantity) },
    { header: "Birim Fiyat", width: 14, align: "right", cell: (r) => fmtMoney(r.unitPrice, cur) },
    {
      header: "İskonto",
      width: 12,
      align: "right",
      cell: (r) => (r.discountAmount > 0 ? `-${fmtMoney(r.discountAmount, cur)}` : "-"),
      // Yüzde girilen iskontoda oran tutarın altında: müşteri "%10" diye pazarlık eder.
      sub: (r) => (r.discountAmount > 0 && r.discountRate && r.discountRate > 0 ? pct(r.discountRate) : null),
    },
    {
      header: "KDV",
      width: 7,
      align: "center",
      cell: (r) => pct(r.vatRate),
    },
    { header: "Tutar", width: 14, align: "right", cell: (r) => fmtMoney(r.totalAmount, cur) },
  ]

  const meta: Content[] = [
    { text: "TEKLİF", style: "docTitle", alignment: "right" },
    { text: softBreak(`No: ${data.quoteNo}`), alignment: "right", margin: [0, mm(1), 0, 0] },
    { text: `Tarih: ${fmtDate(data.date)}`, alignment: "right", margin: [0, mm(1), 0, 0] },
  ]
  if (data.validUntil) {
    meta.push({ text: `Geçerlilik: ${fmtDate(data.validUntil)}`, alignment: "right", margin: [0, mm(1), 0, 0] })
  }
  meta.push({ text: `Para Birimi: ${cur}`, alignment: "right", margin: [0, mm(1), 0, 0] })

  const content: Content[] = [
    // Başlık: solda firma künyesi, sağda belge bilgileri. İki sütun da kendi
    // genişliğinde sarıldığı için uzun unvan/adres sağdaki bloğa binmez.
    {
      columns: [
        { width: "*", ...(partyHeader(data.company) as any) },
        { width: mm(62), stack: meta },
      ],
      columnGap: mm(6),
    },
    section(null, partyBox(data.counterpartyLabel, data.counterparty), mm(6)),
    section(null, docTable({ columns, rows: data.lines, band: sectionBand }), mm(5)),
    totalsBlock(totalRows(data, cur)),
  ]

  if (data.bankAccounts.length > 0) {
    content.push(
      section(
        "ÖDEME BİLGİLERİ",
        docTable({
          columns: [
            { header: "Hesap Adı", width: 24, cell: (a: TeklifPdfBankAccount) => a.name },
            { header: "Banka", width: 22, cell: (a: TeklifPdfBankAccount) => a.bankName || "-" },
            {
              header: "IBAN / Hesap No",
              width: 40,
              cell: (a: TeklifPdfBankAccount) => a.iban || a.accountNumber || "-",
            },
            {
              header: "Para Birimi",
              width: 14,
              align: "center",
              cell: (a: TeklifPdfBankAccount) => a.currency,
            },
          ],
          rows: data.bankAccounts,
        }),
        mm(7),
      ),
    )
  }

  if (data.notes) {
    content.push(section("Notlar", { text: softBreak(data.notes), fontSize: FS.small }, mm(6)))
  }

  return content
}

/**
 * Dip toplam satırları. Ara toplam İSKONTOLAR ÖNCESİDİR ve iskonto varsa matrah
 * ayrıca yazılır — satırlar yukarıdan aşağı toplanabilmeli. (Önceki sürüm ara
 * toplama zaten iskontolu neti yazıp altına iskontoyu bir daha basıyordu.)
 */
function totalRows(data: TeklifPdfData, cur: string) {
  const lineDiscount = data.discountTotal > 0 ? data.discountTotal : 0
  const globalDiscount = (data.globalDiscountAmount ?? 0) > 0 ? data.globalDiscountAmount! : 0
  const rows = [{ label: "Ara Toplam", value: fmtMoney(data.netAmount + lineDiscount + globalDiscount, cur) }]
  if (lineDiscount > 0) {
    rows.push({
      label: globalDiscount > 0 ? "Satır İskontosu" : "İskonto",
      value: `-${fmtMoney(lineDiscount, cur)}`,
    })
  }
  if (globalDiscount > 0) {
    const rate = data.globalDiscountRate && data.globalDiscountRate > 0 ? ` (${pct(data.globalDiscountRate)})` : ""
    rows.push({ label: `Genel İskonto${rate}`, value: `-${fmtMoney(globalDiscount, cur)}` })
  }
  if (lineDiscount > 0 || globalDiscount > 0) {
    rows.push({ label: "KDV Matrahı", value: fmtMoney(data.netAmount, cur) })
  }
  return [
    ...rows,
    { label: "KDV Toplam", value: fmtMoney(data.vatAmount, cur) },
    { label: "GENEL TOPLAM", value: fmtMoney(data.totalAmount, cur), emphasis: true },
  ]
}

/** Route'un çağırdığı tek giriş noktası: veri → PDF buffer. */
export function renderTeklifPdf(data: TeklifPdfData): Promise<Buffer> {
  return renderPdf(
    buildDocDefinition({
      title: `Teklif ${data.quoteNo}`,
      footerNote: `Bu teklif ${new Date().toLocaleString("tr-TR")} tarihinde oluşturulmuştur.`,
      content: buildTeklifContent(data),
    }),
  )
}
