/**
 * Dataset → HTTP yanıtı. Dosya adı, MIME tipi ve indirme başlığı tek yerde.
 */

import { NextResponse } from "next/server"
import type { ExportDataset, ExportFormat } from "./types"
import { buildCsv } from "./csv"
import { buildPdf } from "./pdf"
import { buildXlsx } from "./xlsx"

const MIME: Record<ExportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  csv: "text/csv; charset=utf-8",
}

/**
 * Türkçe karakterleri ASCII'ye indirger. Content-Disposition'ın `filename`
 * alanı latin-1; "Ürün Listesi.xlsx" ham haliyle yazılırsa bazı tarayıcılar
 * dosyayı bozuk adla kaydediyor.
 */
function asciiSlug(input: string): string {
  const map: Record<string, string> = {
    ç: "c", Ç: "C", ğ: "g", Ğ: "G", ı: "i", İ: "I",
    ö: "o", Ö: "O", ş: "s", Ş: "S", ü: "u", Ü: "U",
  }
  return input
    .replace(/[çÇğĞıİöÖşŞüÜ]/g, (char) => map[char] ?? char)
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
}

export function buildFileName(dataset: ExportDataset, format: ExportFormat): string {
  const date = (dataset.generatedAt ?? new Date()).toISOString().slice(0, 10)
  const parts = [asciiSlug(dataset.title), asciiSlug(dataset.company.name), date].filter(Boolean)
  return `${parts.join("_")}.${format}`
}

export async function renderExport(
  dataset: ExportDataset,
  format: ExportFormat,
): Promise<Buffer> {
  if (format === "pdf") return buildPdf(dataset)
  if (format === "csv") return buildCsv(dataset)
  return buildXlsx(dataset)
}

export async function exportResponse(
  dataset: ExportDataset,
  format: ExportFormat,
): Promise<NextResponse> {
  const body = await renderExport(dataset, format)
  const fileName = buildFileName(dataset, format)

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": MIME[format],
      // `filename*` UTF-8 adı taşır, `filename` eski tarayıcılar için ASCII yedeği.
      "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Content-Length": String(body.length),
      "Cache-Control": "no-store",
    },
  })
}
