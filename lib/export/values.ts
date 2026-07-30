/**
 * Hücre değeri normalizasyonu — üç üreticinin ortak zemini.
 *
 * Ham satırlar Prisma'dan geliyor: para/miktar alanları `Decimal` nesnesi,
 * tarihler `Date` ya da ISO string olabiliyor. Her üretici bunu ayrı ayrı
 * çözmeye kalkarsa Excel'de metin, PDF'te "[object Object]" çıkar.
 */

import type { ExportColumn, ExportColumnType, ExportRow, ExportSection } from "./types"

const NUMERIC_TYPES: ExportColumnType[] = ["number", "money", "qty", "percent"]

export function isNumericColumn(column: ExportColumn): boolean {
  return NUMERIC_TYPES.includes(column.type ?? "text")
}

/**
 * Sayıya çevir. Prisma `Decimal` (decimal.js) `valueOf` üzerinden sayıya
 * dönüşür; `null`/boş/parse edilemeyen → `null` (0 DEĞİL: "veri yok" ile
 * "sıfır" farklı şeyler, toplam ortalamasını bozar).
 */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "boolean") return value ? 1 : 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function toDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

const dateFmt = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" })
const dateTimeFmt = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

/**
 * PDF ve CSV'nin gördüğü metin. Excel bunu KULLANMAZ — orada gerçek sayı/tarih
 * hücresi yazılır ki toplam alınabilsin.
 *
 * Para birimi simgesi bilerek yok: kolon başlığı zaten "Tutar (₺)" diyor,
 * her hücreye simge koymak PDF'te kolonu şişiriyor.
 */
export function formatCellText(value: unknown, type: ExportColumnType = "text"): string {
  if (value === null || value === undefined) return ""

  switch (type) {
    case "money": {
      const num = toNumber(value)
      return num === null
        ? ""
        : num.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }
    case "number": {
      const num = toNumber(value)
      return num === null ? "" : num.toLocaleString("tr-TR", { maximumFractionDigits: 2 })
    }
    case "qty": {
      // Stok miktarı Decimal(14,4) — 4 ondalık şart, 20 gr kahve KG cinsinden 0,02.
      const num = toNumber(value)
      return num === null ? "" : num.toLocaleString("tr-TR", { maximumFractionDigits: 4 })
    }
    case "percent": {
      const num = toNumber(value)
      return num === null ? "" : `%${num.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`
    }
    case "date": {
      const date = toDate(value)
      return date ? dateFmt.format(date) : ""
    }
    case "datetime": {
      const date = toDate(value)
      return date ? dateTimeFmt.format(date) : ""
    }
    case "boolean":
      return value ? "Evet" : "Hayır"
    default:
      return String(value)
  }
}

/**
 * CSV'nin gördüğü değer. Metin tipinde `formatCellText` ile aynı, ama sayılar
 * nokta ondalıklı ham haliyle yazılır: CSV makine formatı, yeniden içe
 * aktarılabilmeli (`/api/import` virgüllü sayıyı parse edemez). Excel isteyen
 * kullanıcı XLSX indirir.
 */
export function formatCellRaw(value: unknown, type: ExportColumnType = "text"): string {
  if (value === null || value === undefined) return ""
  if (NUMERIC_TYPES.includes(type)) {
    const num = toNumber(value)
    return num === null ? "" : String(num)
  }
  if (type === "date") {
    const date = toDate(value)
    return date ? date.toISOString().slice(0, 10) : ""
  }
  if (type === "datetime") {
    const date = toDate(value)
    return date ? date.toISOString() : ""
  }
  if (type === "boolean") return value ? "Evet" : "Hayır"
  return String(value)
}

/**
 * Toplam satırını çöz: elle verildiyse onu, `null` ise yok, verilmediyse
 * `total: true` kolonlardan otomatik topla.
 */
export function resolveTotals(section: ExportSection): ExportRow | null {
  if (section.totals !== undefined) return section.totals

  // Boş tabloda "TOPLAM" satırı gürültü — kullanıcı zaten "Kayıt bulunamadı"
  // görüyor, altına bir de boş toplam koymak belgeyi kirletiyor. (Elle verilen
  // toplamlar bundan etkilenmez: onlar hesaplanmış bir sonucu taşır.)
  if (section.rows.length === 0) return null

  const totalColumns = section.columns.filter((column) => column.total)
  if (totalColumns.length === 0) return null

  const totals: ExportRow = {}
  for (const column of totalColumns) {
    let sum = 0
    let seen = false
    for (const row of section.rows) {
      const num = toNumber(row[column.key])
      if (num !== null) {
        sum += num
        seen = true
      }
    }
    totals[column.key] = seen ? sum : null
  }
  return totals
}

export function columnAlign(column: ExportColumn): "left" | "center" | "right" {
  if (column.align) return column.align
  return isNumericColumn(column) ? "right" : "left"
}
