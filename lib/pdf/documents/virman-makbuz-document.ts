import type { Content } from "pdfmake/interfaces"
import { docTable } from "@/lib/pdf/doc/items-table"
import { buildDocDefinition, renderPdf, section } from "@/lib/pdf/doc/page-frame"
import type { PartyLike } from "@/lib/pdf/doc/party-box"
import { softBreak } from "@/lib/pdf/doc/safe-text"
import { COLORS, FS, mm } from "@/lib/pdf/doc/theme"
import { makbuzHeader, makbuzSignatures } from "@/lib/pdf/documents/makbuz-document"
import { VIRMAN_SIDE_LABEL, virmanEtkiBelgeMetni, type CariKind, type VirmanSide } from "@/lib/cari/virman"

/**
 * CARİ VİRMAN MAKBUZU — kural `lib/cari/virman.ts`.
 *
 * Kasa/çek makbuzundan ayrı belge: para bir kanaldan girip çıkmaz, "Ödeme
 * Yöntemi / Hesap" satırı ve "Teslim Eden / Teslim Alan" imzası anlamsızdır.
 * Basılan şey fişin kendisidir: hangi cari borçlandı, hangisi alacaklandı ve
 * bunun her carinin bakiyesine etkisi. Başlık ve imza şeridi kasa makbuzuyla
 * ortaktır (`makbuzHeader`, `makbuzSignatures`).
 */

export type VirmanMakbuzLeg = {
  side: VirmanSide
  kind: CariKind
  name: string
  taxNumber?: string | null
}

export type VirmanMakbuzPdfData = {
  virmanNo: string
  date: string | Date
  amount: number
  description?: string | null
  company: PartyLike
  /** 1 bacak = tek taraflı dekont, 2 bacak = iki cari arası aktarım. */
  legs: VirmanMakbuzLeg[]
}

const money = (amount: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(Number(amount) || 0)

const KIND_LABEL: Record<CariKind, string> = { customer: "Müşteri", supplier: "Tedarikçi" }

/** Borç bacağı önce: fiş muhasebe sırasıyla okunur. */
const orderLegs = (legs: VirmanMakbuzLeg[]) =>
  [...legs].sort((a, b) => (a.side === b.side ? 0 : a.side === "DEBIT" ? -1 : 1))

/** Fişin tek cümlelik özeti — tablonun yönünü bilmeyen okuyucu için. */
export function virmanOzetCumlesi(legs: VirmanMakbuzLeg[], amount: number): string {
  const tutar = money(amount)
  const debit = legs.find((l) => l.side === "DEBIT")
  const credit = legs.find((l) => l.side === "CREDIT")
  if (debit && credit) {
    return `${tutar} tutarındaki bakiye, ${credit.name} hesabına alacak, ${debit.name} hesabına borç kaydedilerek aktarılmıştır.`
  }
  const only = debit ?? credit
  if (!only) return ""
  return `${tutar}, ${only.name} hesabına ${only.side === "DEBIT" ? "borç" : "alacak"} kaydedilmiştir. Karşı hesabı olmayan tek taraflı dekonttur.`
}

export function buildVirmanMakbuzContent(data: VirmanMakbuzPdfData): Content[] {
  const legs = orderLegs(data.legs)
  const content: Content[] = [
    makbuzHeader(data.company, "Virman Makbuzu", `Virman No: ${data.virmanNo}`, data.date),
  ]

  // Tutar vurgusu — kasa makbuzuyla aynı ölçüde.
  content.push({
    columns: [
      { width: "*", text: "Virman Tutarı", bold: true, fontSize: FS.h2 },
      { width: "auto", text: softBreak(money(data.amount)), bold: true, fontSize: FS.title, alignment: "right" },
    ],
    columnGap: mm(4),
    margin: [0, mm(8), 0, 0],
  })

  content.push({
    table: {
      widths: ["*"],
      body: [
        [
          {
            text: softBreak(virmanOzetCumlesi(legs, data.amount)),
            fillColor: COLORS.boxBg,
            margin: [mm(2), mm(2), mm(2), mm(2)],
          },
        ],
      ],
    },
    layout: "noBorders",
    margin: [0, mm(4), 0, 0],
  })

  content.push(
    section(
      "Hesap Hareketleri",
      docTable<VirmanMakbuzLeg>({
        columns: [
          {
            header: "Cari Hesap",
            width: 42,
            cell: (l) => l.name,
            sub: (l) => [KIND_LABEL[l.kind], l.taxNumber ? `VKN/TCKN: ${l.taxNumber}` : null].filter(Boolean).join(" · "),
          },
          { header: "İşlem", width: 16, cell: (l) => VIRMAN_SIDE_LABEL[l.side] },
          { header: "Borç", width: 16, align: "right", cell: (l) => (l.side === "DEBIT" ? money(data.amount) : "—") },
          { header: "Alacak", width: 16, align: "right", cell: (l) => (l.side === "CREDIT" ? money(data.amount) : "—") },
          { header: "Bakiyeye Etkisi", width: 26, cell: (l) => virmanEtkiBelgeMetni(l.kind, l.side) },
        ],
        rows: legs,
      }),
      mm(6),
    ),
  )

  if (data.description?.trim()) {
    content.push(
      section("Açıklama", { text: softBreak(data.description.trim()) }, mm(6)),
    )
  }

  content.push({
    text: "Bu belge kasa veya banka hareketi içermez; cari hesaplar arasındaki bakiye aktarımını belgeler.",
    fontSize: FS.tiny,
    color: COLORS.muted,
    margin: [0, mm(6), 0, 0],
  })

  content.push(makbuzSignatures("Düzenleyen", "Onaylayan"))

  return content
}

export function renderVirmanMakbuzPdf(data: VirmanMakbuzPdfData): Promise<Buffer> {
  return renderPdf(
    buildDocDefinition({
      title: `Virman Makbuzu ${data.virmanNo}`,
      footerNote: `${new Date().toLocaleString("tr-TR")} · Kobipo Ön Muhasebe`,
      content: buildVirmanMakbuzContent(data),
    }),
  )
}
