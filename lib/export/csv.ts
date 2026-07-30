/**
 * CSV üreticisi — RFC 4180.
 *
 * Eski `/api/export` kaçış yapmadan `join(",")` çekiyordu: adresinde virgül
 * olan tek bir cari tüm dosyanın kolonlarını kaydırıyordu ve kimse fark
 * etmiyordu. Burada virgül/tırnak/yeni satır içeren her alan tırnaklanır,
 * içerideki tırnak ikilenir.
 *
 * Ayırıcı virgül ve ondalık nokta: bu dosya `/api/import`'un `parseCsv`
 * ayrıştırıcısına geri verilebilmeli (dışa aktar → düzenle → içe aktar).
 * Excel'e gidecek kullanıcı XLSX indirir; orada sayılar zaten gerçek sayıdır.
 */

import type { ExportDataset } from "./types"
import { formatCellRaw, resolveTotals } from "./values"

/** Excel'in UTF-8'i tanıması için BOM — yoksa "Ürün" → "Ãœrün". */
const BOM = "﻿"

function escapeCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value
  return `"${value.replaceAll('"', '""')}"`
}

function toLine(cells: string[]): string {
  return cells.map(escapeCell).join(",")
}

export function buildCsv(dataset: ExportDataset): Buffer {
  const lines: string[] = []

  dataset.sections.forEach((section, index) => {
    // Tek bölümlü belgede başlık gürültü; çok bölümlüde hangi tablo olduğu şart.
    if (dataset.sections.length > 1) {
      if (index > 0) lines.push("")
      if (section.title) lines.push(toLine([section.title]))
    }

    lines.push(toLine(section.columns.map((column) => column.label)))

    for (const row of section.rows) {
      lines.push(toLine(section.columns.map((column) => formatCellRaw(row[column.key], column.type))))
    }

    const totals = resolveTotals(section)
    if (totals) {
      lines.push(
        toLine(
          section.columns.map((column, columnIndex) => {
            if (column.key in totals) return formatCellRaw(totals[column.key], column.type)
            return columnIndex === 0 ? "TOPLAM" : ""
          }),
        ),
      )
    }
  })

  return Buffer.from(BOM + lines.join("\r\n"), "utf8")
}
