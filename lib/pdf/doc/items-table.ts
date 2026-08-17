import type { Content } from "pdfmake/interfaces"
import { CONTENT_WIDTH } from "./page-frame"
import { softBreak } from "./safe-text"
import { COLORS, FS, mm } from "./theme"

/**
 * Genel amaçlı belge tablosu.
 *
 * Kolon genişlikleri GÖRECELİ ağırlıkla verilir ve içerik genişliğine oranlanır;
 * böylece kâğıt/kenar boşluğu değişse de kolonlar birbirine göre aynı kalır.
 * Hücre metni kendi hücresinde sarılır, satır yüksekliği içeriğe göre uzar,
 * başlık satırı (headerRows) yeni sayfada tekrar basılır.
 */

export type Align = "left" | "right" | "center"

export type Column<Row> = {
  header: string
  /** Göreceli ağırlık (birbirine göre). */
  width: number
  align?: Align
  cell: (row: Row, index: number) => string
  /** Ana metnin ALTINA basılan ikinci satır (ör. kalem açıklaması). */
  sub?: (row: Row, index: number) => string | null | undefined
}

export function docTable<Row>({
  columns,
  rows,
  zebra = true,
  headColor = COLORS.headBg,
  containerWidth = CONTENT_WIDTH,
}: {
  columns: Column<Row>[]
  rows: Row[]
  zebra?: boolean
  /** Başlık şerit rengi (belge şablonuna göre değişebilir). */
  headColor?: string
  /**
   * Tablonun içine yerleşeceği kutunun genişliği (pt). Varsayılan tam içerik
   * genişliği; tablo bir KOLONUN içindeyse (ör. bordroda yan yana iki tablo)
   * o kolonun genişliği verilmelidir — aksi halde tablo kolondan taşar.
   */
  containerWidth?: number
}): Content {
  const totalWeight = columns.reduce((s, c) => s + c.width, 0)
  const widths = columns.map((c) => (containerWidth * c.width) / totalWeight)

  const head = columns.map((c) => ({
    text: softBreak(c.header),
    alignment: c.align || "left",
    bold: true,
    fontSize: FS.small,
    color: COLORS.headText,
    margin: [mm(1.2), mm(1.4), mm(1.2), mm(1.4)] as [number, number, number, number],
  }))

  const body = rows.map((row, r) =>
    columns.map((c) => {
      const sub = c.sub?.(row, r)
      const main = { text: softBreak(c.cell(row, r)), alignment: c.align || "left", fontSize: FS.small }
      return {
        stack: sub ? [main, { text: softBreak(sub), style: "sub", alignment: c.align || "left" }] : [main],
        margin: [mm(1.2), mm(1.2), mm(1.2), mm(1.2)] as [number, number, number, number],
      }
    }),
  )

  return {
    table: { headerRows: 1, widths, body: [head, ...body] },
    layout: {
      hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 0.5 : 0.5),
      vLineWidth: () => 0,
      hLineColor: () => COLORS.line,
      fillColor: (rowIndex: number) => {
        if (rowIndex === 0) return headColor
        if (zebra && rowIndex % 2 === 0) return COLORS.zebra
        return null
      },
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  }
}
