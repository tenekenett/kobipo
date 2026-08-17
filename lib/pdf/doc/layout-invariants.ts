import { extractTextRuns, ptToMm, type TextRun } from "./extract-text-runs"
import { PAGE } from "./theme"

/**
 * Belge yerleşiminin DEĞİŞMEZLERİ — her PDF üreticisi bunlara uymak zorunda.
 *
 * Buradaki kontroller üretilmiş PDF üzerinde, belgenin kendi font metriğiyle
 * yapılır; motora, kütüphaneye ve şablona bağımlı değildir. Amaç, "hangi içerik
 * uzunluğunda ne kayıyor" sorusunu gözle aramayı bırakıp makineye sormak:
 *
 *   1. TAŞMA   — hiçbir metin sayfa kenar boşluğunun dışına çıkmaz.
 *   2. ÇAKIŞMA — aynı satırdaki iki metin parçası üst üste binmez
 *                (kolonların birbirini ezmesi bu kontrolle yakalanır).
 */

export type Violation = {
  kind: "overflow" | "overlap"
  message: string
}

const DEFAULT_PAGE_WIDTH = 595.28

export type LayoutCheckOptions = {
  pageWidth?: number
  marginLeft?: number
  marginRight?: number
  /** Yuvarlama payı (pt). */
  tolerance?: number
  /** Aynı satır sayılacak taban çizgisi farkı (pt). */
  lineTolerance?: number
}

export function checkRuns(allRuns: TextRun[], opts: LayoutCheckOptions = {}): Violation[] {
  // Filigran/damga gibi DÖNDÜRÜLMÜŞ metinler denetim dışıdır: çapraz "TASLAK"
  // yazısı bilerek sayfayı kaplar ve içeriğin arkasında durur; yatay taşma
  // ölçüsü ona uygulanamaz.
  const runs = allRuns.filter((r) => !r.rotated)
  const pageWidth = opts.pageWidth ?? DEFAULT_PAGE_WIDTH
  const left = opts.marginLeft ?? PAGE.paddingHorizontal
  const right = pageWidth - (opts.marginRight ?? PAGE.paddingHorizontal)
  const tol = opts.tolerance ?? 2
  const lineTol = opts.lineTolerance ?? 1.5

  const violations: Violation[] = []

  for (const r of runs) {
    if (r.x < left - tol || r.x + r.width > right + tol) {
      violations.push({
        kind: "overflow",
        message:
          `TAŞMA: "${short(r.text)}" x=${ptToMm(r.x).toFixed(1)}mm ` +
          `son=${ptToMm(r.x + r.width).toFixed(1)}mm (izin: ${ptToMm(left).toFixed(1)}–${ptToMm(right).toFixed(1)}mm)`,
      })
    }
  }

  // Aynı taban çizgisindeki parçaları soldan sağa sıralayıp bindirme ara.
  // Kova anahtarı SAYFA + taban çizgisi: iki sayfanın altlığı aynı y'de durur,
  // yalnız y'ye bakan gruplama onları "çakışma" sanıyordu.
  const lines = new Map<string, TextRun[]>()
  for (const r of runs) {
    const key = `${r.page}:${Math.round(r.y / lineTol)}`
    const bucket = lines.get(key)
    if (bucket) bucket.push(r)
    else lines.set(key, [r])
  }
  for (const bucket of lines.values()) {
    const sorted = [...bucket].sort((a, b) => a.x - b.x)
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]
      const cur = sorted[i]
      if (prev.x + prev.width > cur.x + tol) {
        violations.push({
          kind: "overlap",
          message:
            `ÇAKIŞMA: "${short(prev.text)}" (x ${ptToMm(prev.x).toFixed(1)}→${ptToMm(prev.x + prev.width).toFixed(1)}mm) ` +
            `ile "${short(cur.text)}" (x ${ptToMm(cur.x).toFixed(1)}mm) — y=${ptToMm(cur.y).toFixed(1)}mm`,
        })
      }
    }
  }

  return violations
}

/** PDF buffer'ı doğrudan denetler. */
export function checkPdf(pdf: Buffer, opts: LayoutCheckOptions = {}): Violation[] {
  return checkRuns(extractTextRuns(pdf), opts)
}

function short(text: string) {
  const t = text.replace(/\s+/g, " ").trim()
  return t.length > 38 ? `${t.slice(0, 38)}…` : t
}
