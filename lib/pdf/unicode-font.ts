import type jsPDF from "jspdf"

/**
 * jsPDF default "helvetica" fontu WinAnsi encoded — Türkçe karakterler
 * (ş, ğ, ı, İ, Ç, Ö, Ü vs.) düzgün render edilemiyor. Bu helper DejaVu Sans
 * (Unicode) TTF'sini jsPDF'e kaydeder ve aktif font olarak ayarlar.
 *
 * Server (Node) tarafında çalışır: TTF'yi `node_modules/dejavu-fonts-ttf/ttf/`
 * altından fs ile okur. Client tarafında fetch ile aynı dosyayı çekecek bir
 * yol gerekirse `loadClient` benzeri ayrı bir helper yazılır.
 */

const FONT_NAME = "DejaVuSans"

let regularCache: string | null = null
let boldCache: string | null = null

async function loadAsBase64(filename: string): Promise<string> {
  const fs = await import("node:fs/promises")
  const path = await import("node:path")
  // İKİ kaynak denenir: paket (dejavu-fonts-ttf) ve public/fonts. Tek kaynağa
  // bağlıyken font paketten dışlanan bir ortamda PDF üretimi komple ENOENT ile
  // düşüyordu; ikisi de next.config.js > outputFileTracingIncludes ile pakete
  // dahil ediliyor.
  const candidates = [
    path.join(process.cwd(), "node_modules", "dejavu-fonts-ttf", "ttf", filename),
    path.join(process.cwd(), "public", "fonts", filename),
  ]
  for (const filePath of candidates) {
    try {
      const buf = await fs.readFile(filePath)
      return buf.toString("base64")
    } catch {
      /* sıradaki kaynağı dene */
    }
  }
  throw new Error(`PDF fontu bulunamadı: ${filename}`)
}

export async function registerTurkishFont(doc: jsPDF) {
  if (!regularCache) regularCache = await loadAsBase64("DejaVuSans.ttf")
  if (!boldCache) boldCache = await loadAsBase64("DejaVuSans-Bold.ttf")

  doc.addFileToVFS(`${FONT_NAME}.ttf`, regularCache)
  doc.addFont(`${FONT_NAME}.ttf`, FONT_NAME, "normal")

  doc.addFileToVFS(`${FONT_NAME}-Bold.ttf`, boldCache)
  doc.addFont(`${FONT_NAME}-Bold.ttf`, FONT_NAME, "bold")

  doc.setFont(FONT_NAME, "normal")
  return FONT_NAME
}

export const TURKISH_PDF_FONT = FONT_NAME

/**
 * Client-side variant — TTF dosyalarını `/fonts/*` üzerinden fetch eder
 * (public/fonts/ altında). Server-side `registerTurkishFont` ile aynı işi yapar.
 */
let regularClientCache: string | null = null
let boldClientCache: string | null = null

async function fetchAsBase64(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Font yüklenemedi: ${url}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  let binary = ""
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i])
  return typeof btoa === "function" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64")
}

export async function registerTurkishFontClient(doc: jsPDF) {
  if (!regularClientCache) regularClientCache = await fetchAsBase64("/fonts/DejaVuSans.ttf")
  if (!boldClientCache) boldClientCache = await fetchAsBase64("/fonts/DejaVuSans-Bold.ttf")

  doc.addFileToVFS(`${FONT_NAME}.ttf`, regularClientCache)
  doc.addFont(`${FONT_NAME}.ttf`, FONT_NAME, "normal")

  doc.addFileToVFS(`${FONT_NAME}-Bold.ttf`, boldClientCache)
  doc.addFont(`${FONT_NAME}-Bold.ttf`, FONT_NAME, "bold")

  doc.setFont(FONT_NAME, "normal")
  return FONT_NAME
}
