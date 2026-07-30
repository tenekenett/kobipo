/**
 * Excel üreticisi.
 *
 * Eski `/api/export` her alanı `String()`'e sarıp `aoa_to_sheet`'e veriyordu:
 * tutar ve stok kolonları Excel'de METİN oluyordu, kullanıcı toplam alamıyor,
 * sıralama alfabetik çıkıyordu (1000 < 200). Burada her hücre kendi tipiyle
 * yazılır — sayı sayı, tarih tarih.
 *
 * Biçim (`z`) ve kolon genişliği (`!cols`) SheetJS community sürümünde yazılır;
 * hücre stili (kalın başlık, renk) yazılmaz — o yüzden başlık vurgusu yerine
 * otomatik filtre (`!autofilter`) kullanılıyor.
 */

import * as XLSX from "xlsx"
import type { ExportColumn, ExportDataset, ExportRow, ExportSection } from "./types"
import { formatCellText, isNumericColumn, resolveTotals, toDate, toNumber } from "./values"

const NUMBER_FORMATS: Record<string, string> = {
  money: "#,##0.00",
  number: "#,##0.###",
  qty: "#,##0.####",
  percent: '0.00"%"',
  date: "dd.mm.yyyy",
  datetime: "dd.mm.yyyy hh:mm",
}

type Cell = XLSX.CellObject

function buildCell(value: unknown, column: ExportColumn): Cell | null {
  const type = column.type ?? "text"
  if (value === null || value === undefined || value === "") return null

  if (isNumericColumn(column)) {
    const num = toNumber(value)
    if (num === null) return { t: "s", v: String(value) }
    return { t: "n", v: num, z: NUMBER_FORMATS[type] }
  }

  if (type === "date" || type === "datetime") {
    const date = toDate(value)
    if (!date) return null
    return { t: "d", v: date, z: NUMBER_FORMATS[type] }
  }

  if (type === "boolean") return { t: "s", v: value ? "Evet" : "Hayır" }

  return { t: "s", v: String(value) }
}

/** Excel sayfa adı: en fazla 31 karakter, `[]:*?/\` yasak, boş olamaz. */
function safeSheetName(raw: string, fallback: string, used: Set<string>): string {
  let name = (raw || fallback).replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || fallback
  if (used.has(name)) {
    // Aynı adlı ikinci sayfa Excel'de dosyayı bozar; sonuna sayaç ekle.
    let counter = 2
    const base = name.slice(0, 28)
    while (used.has(`${base} (${counter})`)) counter++
    name = `${base} (${counter})`
  }
  used.add(name)
  return name
}

function columnWidths(section: ExportSection, totals: ExportRow | null): XLSX.ColInfo[] {
  return section.columns.map((column) => {
    let widest = column.label.length
    // Tüm satırları ölçmek 50k satırda pahalı; ilk 200 satır genişlik için yeterli
    // temsil veriyor.
    const sample = section.rows.slice(0, 200)
    for (const row of sample) {
      const text = formatCellText(row[column.key], column.type)
      if (text.length > widest) widest = text.length
    }
    if (totals && column.key in totals) {
      const text = formatCellText(totals[column.key], column.type)
      if (text.length > widest) widest = text.length
    }
    return { wch: Math.min(50, Math.max(9, widest + 2)) }
  })
}

function buildSheet(section: ExportSection): XLSX.WorkSheet {
  const sheet: XLSX.WorkSheet = {}
  const totals = resolveTotals(section)

  section.columns.forEach((column, columnIndex) => {
    sheet[XLSX.utils.encode_cell({ r: 0, c: columnIndex })] = { t: "s", v: column.label }
  })

  section.rows.forEach((row, rowIndex) => {
    section.columns.forEach((column, columnIndex) => {
      const cell = buildCell(row[column.key], column)
      if (cell) sheet[XLSX.utils.encode_cell({ r: rowIndex + 1, c: columnIndex })] = cell
    })
  })

  let lastRow = section.rows.length
  if (totals) {
    lastRow += 1
    section.columns.forEach((column, columnIndex) => {
      const address = XLSX.utils.encode_cell({ r: lastRow, c: columnIndex })
      if (column.key in totals) {
        const cell = buildCell(totals[column.key], column)
        if (cell) sheet[address] = cell
      } else if (columnIndex === 0) {
        sheet[address] = { t: "s", v: "TOPLAM" }
      }
    })
  }

  sheet["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: Math.max(lastRow, 0), c: Math.max(section.columns.length - 1, 0) },
  })
  sheet["!cols"] = columnWidths(section, totals)
  if (section.rows.length > 0) {
    sheet["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: section.rows.length, c: Math.max(section.columns.length - 1, 0) },
      }),
    }
  }

  return sheet
}

/**
 * Künye sayfası — hangi firma, hangi filtre, ne zaman. Veri sayfalarının
 * üstüne yazılmıyor bilerek: başlık 1. satırda kalsın ki otomatik filtre,
 * pivot ve yeniden içe aktarma çalışsın.
 */
function buildInfoSheet(dataset: ExportDataset): XLSX.WorkSheet {
  const rows: string[][] = [
    ["Rapor", dataset.title],
    ["Firma", dataset.company.name],
  ]
  if (dataset.company.taxNumber) rows.push(["VKN/TCKN", dataset.company.taxNumber])
  rows.push(["Oluşturma", formatCellText(dataset.generatedAt ?? new Date(), "datetime")])
  for (const filter of dataset.filters ?? []) rows.push(["Filtre", filter])
  if (dataset.note) rows.push(["Not", dataset.note])

  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet["!cols"] = [{ wch: 14 }, { wch: 60 }]
  return sheet
}

export function buildXlsx(dataset: ExportDataset): Buffer {
  const workbook = XLSX.utils.book_new()
  const used = new Set<string>()

  dataset.sections.forEach((section, index) => {
    const name = safeSheetName(
      section.sheetName || section.title || dataset.title,
      `Sayfa ${index + 1}`,
      used,
    )
    XLSX.utils.book_append_sheet(workbook, buildSheet(section), name)
  })

  XLSX.utils.book_append_sheet(workbook, buildInfoSheet(dataset), safeSheetName("Rapor Bilgisi", "Bilgi", used))

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", cellDates: true }) as Buffer
}
