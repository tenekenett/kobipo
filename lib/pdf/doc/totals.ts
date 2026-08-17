import type { Content } from "pdfmake/interfaces"
import { COLORS, FS, mm } from "./theme"

/**
 * Dip toplam bloğu — sağa yapışık etiket/değer çiftleri.
 *
 * Değer hücresi sağa hizalanır ve hizalamayı motor font ölçümüyle yapar. jsPDF
 * sürümünde her satır `doc.text(..., 196, y, { align: "right" })` ile elle
 * yerleştiriliyor, etiket uzayınca değerin üstüne biniyordu.
 */

export type TotalRow = {
  label: string
  value: string
  /** Genel toplam: kalın + renkli + üst çizgi. */
  emphasis?: boolean
}

const BOX_WIDTH = mm(78)

export function totalsBlock(rows: TotalRow[]): Content {
  const body = rows.map((r) => [
    {
      text: r.label,
      fontSize: r.emphasis ? FS.h2 : FS.body,
      bold: r.emphasis === true,
      color: r.emphasis ? COLORS.text : COLORS.muted,
      margin: [0, mm(1), 0, mm(1)] as [number, number, number, number],
    },
    {
      text: r.value,
      alignment: "right" as const,
      fontSize: r.emphasis ? FS.h2 : FS.body,
      bold: r.emphasis === true,
      color: r.emphasis ? COLORS.total : COLORS.text,
      margin: [0, mm(1), 0, mm(1)] as [number, number, number, number],
    },
  ])

  return {
    columns: [
      { text: "", width: "*" },
      {
        width: BOX_WIDTH,
        table: { widths: ["*", "auto"], body },
        layout: {
          // Yalnız genel toplam satırının ÜSTÜNDE ayraç çizgisi.
          hLineWidth: (i: number) => (rows[i]?.emphasis ? 0.5 : 0),
          vLineWidth: () => 0,
          hLineColor: () => COLORS.line,
          paddingLeft: () => 0,
          paddingRight: () => 0,
          paddingTop: () => 0,
          paddingBottom: () => 0,
        },
      },
    ],
    margin: [0, mm(4), 0, 0],
  }
}
