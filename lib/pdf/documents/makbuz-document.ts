import type { Content } from "pdfmake/interfaces"
import { docTable } from "@/lib/pdf/doc/items-table"
import { buildDocDefinition, renderPdf, section } from "@/lib/pdf/doc/page-frame"
import { partyHeader, type PartyLike } from "@/lib/pdf/doc/party-box"
import { fmtDate } from "@/lib/pdf/doc/money"
import { softBreak } from "@/lib/pdf/doc/safe-text"
import { COLORS, FS, mm } from "@/lib/pdf/doc/theme"

/**
 * TAHSİLAT / ÖDEME MAKBUZU.
 *
 * Eski sürüm istemcide jsPDF ile çiziliyordu ve başlık genişliğini ölçüp firma
 * unvanını ona göre kırpmak gibi elle çakışma çözümleri içeriyordu
 * (`companyMaxW = max(70, titleLeftX - 22)`), cari adı tek satıra budanıyordu
 * (`slice(0,1)`). Artık akış tabanlı ve sunucu tarafında: ekrandan indirilen
 * makbuz ile sunucudan giden birebir aynı.
 */

export type MakbuzPdfData = {
  /** "Tahsilat" | "Ödeme" | "Gelir" | "Gider" */
  kind: string
  makbuzNo: string
  date: string | Date
  amount: number
  currency: string
  description?: string | null
  reference?: string | null
  paymentMethod: string
  account: { name: string; bankName?: string | null }
  company: PartyLike
  cari?: { label: string; name: string; taxNumber?: string | null } | null
  invoices: Array<{ invoiceNo: string; amount: number }>
}

const money = (amount: number, currency = "TRY") =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency }).format(Number(amount) || 0)

export function buildMakbuzContent(data: MakbuzPdfData): Content[] {
  const isIncome = data.kind === "Tahsilat" || data.kind === "Gelir"
  const cur = data.currency || "TRY"

  const infoRows: Array<{ label: string; value: string }> = [
    { label: "Ödeme Yöntemi", value: data.paymentMethod },
    {
      label: "Hesap",
      value: data.account.bankName
        ? `${data.account.name} · ${data.account.bankName}`
        : data.account.name,
    },
  ]
  if (data.reference) infoRows.push({ label: "Referans", value: data.reference })
  if (data.description?.trim()) {
    infoRows.push({ label: "Açıklama", value: data.description.trim() })
  }

  const content: Content[] = [
    {
      columns: [
        { width: "*", ...(partyHeader(data.company) as any) },
        {
          width: mm(62),
          stack: [
            {
              text: `${data.kind.toLocaleUpperCase("tr-TR")} MAKBUZU`,
              style: "docTitle",
              alignment: "right",
            },
            {
              text: softBreak(`Makbuz No: ${data.makbuzNo}`),
              alignment: "right",
              margin: [0, mm(1), 0, 0],
            },
            { text: `Tarih: ${fmtDate(data.date)}`, alignment: "right", margin: [0, mm(1), 0, 0] },
          ],
        },
      ],
      columnGap: mm(6),
    },
  ]

  // Cari kutusu (varsa) — ad ve VKN iki sütunda, ikisi de kendi genişliğinde sarılır.
  if (data.cari) {
    content.push({
      table: {
        widths: ["*", "auto"],
        body: [
          [
            {
              stack: [
                { text: data.cari.label, bold: true, fontSize: FS.small },
                { text: softBreak(data.cari.name), fontSize: FS.h2, margin: [0, mm(1), 0, 0] },
              ],
              fillColor: COLORS.boxBg,
              margin: [mm(2), mm(2), mm(2), mm(2)],
            },
            {
              text: data.cari.taxNumber ? softBreak(`VKN/TCKN: ${data.cari.taxNumber}`) : "",
              fontSize: FS.small,
              alignment: "right",
              fillColor: COLORS.boxBg,
              margin: [mm(2), mm(2), mm(2), mm(2)],
            },
          ],
        ],
      },
      layout: {
        hLineWidth: () => 0,
        vLineWidth: () => 0,
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 0,
        paddingBottom: () => 0,
      },
      margin: [0, mm(6), 0, 0],
    })
  }

  // Tutar vurgusu.
  content.push({
    columns: [
      {
        width: "*",
        text: isIncome ? "Tahsil Edilen Tutar" : "Ödenen Tutar",
        bold: true,
        fontSize: FS.h2,
      },
      {
        width: "auto",
        text: softBreak(money(data.amount, cur)),
        bold: true,
        fontSize: FS.title,
        alignment: "right",
      },
    ],
    columnGap: mm(4),
    margin: [0, mm(6), 0, 0],
  })

  content.push(
    section(
      null,
      docTable<{ label: string; value: string }>({
        columns: [
          { header: "Bilgi", width: 30, cell: (r) => r.label },
          { header: "Değer", width: 70, cell: (r) => r.value },
        ],
        rows: infoRows,
      }),
      mm(4),
    ),
  )

  if (data.invoices.length > 0) {
    content.push(
      section(
        "Eşleştiği Faturalar",
        docTable<{ invoiceNo: string; amount: number }>({
          columns: [
            { header: "Fatura No", width: 60, cell: (r) => r.invoiceNo },
            { header: "Tutar", width: 40, align: "right", cell: (r) => money(r.amount, cur) },
          ],
          rows: data.invoices,
        }),
        mm(6),
      ),
    )
  }

  // İmza alanları — akışın sonunda; çizgi tablo kenarlığından gelir, mutlak
  // koordinatlı `doc.line()` çağrısı yok.
  const signatureCell = (label: string) => ({
    table: { widths: ["*"], body: [[{ text: " ", margin: [0, mm(10), 0, 0] }], [{ text: label, alignment: "center" as const, fontSize: FS.small, margin: [0, mm(1.5), 0, 0] }]] },
    layout: {
      hLineWidth: (i: number) => (i === 1 ? 0.5 : 0),
      vLineWidth: () => 0,
      hLineColor: () => COLORS.line,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  })

  content.push({
    columns: [
      { width: "*", ...signatureCell("Teslim Eden") },
      { width: "*", ...signatureCell("Teslim Alan") },
    ],
    columnGap: mm(14),
    margin: [0, mm(18), 0, 0],
  } as unknown as Content)

  return content
}

export function renderMakbuzPdf(data: MakbuzPdfData): Promise<Buffer> {
  return renderPdf(
    buildDocDefinition({
      title: `${data.kind} Makbuzu ${data.makbuzNo}`,
      footerNote: `${new Date().toLocaleString("tr-TR")} · Kobipo Ön Muhasebe`,
      content: buildMakbuzContent(data),
    }),
  )
}
