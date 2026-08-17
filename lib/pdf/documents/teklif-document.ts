import type { Content } from "pdfmake/interfaces"
import { docTable, type Column } from "@/lib/pdf/doc/items-table"
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
  description: string
  note?: string | null
  quantity: number
  unitPrice: number
  discountAmount: number
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
  netAmount: number
  vatAmount: number
  totalAmount: number
  discountTotal: number
  bankAccounts: TeklifPdfBankAccount[]
}

export function buildTeklifContent(data: TeklifPdfData): Content[] {
  const cur = data.currency || "TRY"

  const columns: Column<TeklifPdfLine>[] = [
    { header: "#", width: 5, align: "center", cell: (_r, i) => String(i + 1) },
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
    },
    {
      header: "KDV",
      width: 7,
      align: "center",
      cell: (r) => `%${fmtNumber(r.vatRate).replace(",00", "")}`,
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
    section(null, docTable({ columns, rows: data.lines }), mm(5)),
    totalsBlock([
      { label: "Ara Toplam", value: fmtMoney(data.netAmount, cur) },
      ...(data.discountTotal > 0
        ? [{ label: "İskonto", value: `-${fmtMoney(data.discountTotal, cur)}` }]
        : []),
      { label: "KDV Toplam", value: fmtMoney(data.vatAmount, cur) },
      { label: "GENEL TOPLAM", value: fmtMoney(data.totalAmount, cur), emphasis: true },
    ]),
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
