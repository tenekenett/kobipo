import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { registerTurkishFont, TURKISH_PDF_FONT } from "@/lib/pdf/unicode-font"

/**
 * GİB e-Arşiv / e-Fatura görünümünü TAKLİT eden taslak PDF üreteci.
 *
 * ÖNEMLİ: Bu YASAL bir belge DEĞİLDİR. Resmî GİB PDF'i yalnızca Mysoft, fatura
 * gönderildikten (ETTN/uuid alındıktan) sonra üretir — bkz.
 * `app/api/e-donusum/invoices/[id]/pdf/route.ts`. Buradaki çıktı, kullanıcı
 * faturayı resmileştirmeden önce GİB düzeninde bir ÖN İZLEME görebilsin diye
 * üretilir ve üzerinde belirgin "TASLAK" filigranı taşır.
 *
 * Etiketler ve kolon düzeni, gönderimde kullanılan örnek XSLT'lerle (e-arsiv.xslt,
 * e-fatura.xslt) aynı GİB terminolojisini kullanır: "Mal Hizmet Toplam Tutarı",
 * "Vergiler Dahil Toplam Tutar", "Ödenecek Tutar", "Senaryo", "ETTN" vb.
 */

export type GibDocKind = "E_INVOICE" | "E_ARCHIVE" | "MANUAL"

export interface GibInvoiceParty {
  name: string
  taxNumber?: string | null
  taxOffice?: string | null
  address?: string | null
  district?: string | null
  city?: string | null
  phone?: string | null
  email?: string | null
}

export interface GibInvoiceLine {
  description: string
  quantity: number
  unit?: string | null
  unitPrice: number
  discountAmount: number
  discountRate?: number | null
  vatRate: number
  vatAmount: number
  /** KDV tevkifat oranı (KDV'nin yüzdesi, ör. 50). Varsa satırda gösterilir. */
  withholdingRate?: number | null
  /** Mal Hizmet Tutarı — iskonto sonrası, KDV hariç satır neti */
  lineNet: number
}

export interface GibInvoiceTotals {
  /** Mal Hizmet Toplam Tutarı — satırların brüt (miktar×fiyat) toplamı */
  grossTotal: number
  /** Satır iskontoları toplamı */
  lineDiscountTotal: number
  /** Fatura altı (genel) iskonto */
  globalDiscount: number
  /** Fatura altı ilave (masraf) — KDV matrahına dahildir. */
  globalCharge?: number
  /** Dip toplam yuvarlaması — KDV'ye girmez, ödenecek tutara eklenir. */
  rounding?: number
  /** KDV Matrahı */
  netAmount: number
  /** Hesaplanan KDV */
  vatAmount: number
  /** KDV Tevkifatı (varsa) */
  withholdingAmount: number
  /** ÖTV (varsa) */
  exciseAmount: number
  /** Diğer vergiler — ör. Konaklama Vergisi (varsa) */
  otherTaxAmount: number
  otherTaxLabel?: string | null
  /** Ödenecek Tutar (vergiler dahil, tevkifat düşülmüş) */
  totalAmount: number
}

export interface GibInvoiceData {
  invoiceNo: string
  ettn?: string | null
  date: string
  dueDate?: string | null
  type: "SALES" | "PURCHASE" | "RETURN"
  invoiceType: GibDocKind
  currency?: string
  company: GibInvoiceParty
  counterparty?: GibInvoiceParty | null
  items: GibInvoiceLine[]
  totals: GibInvoiceTotals
  notes?: string | null
  /** true (varsayılan) ise "TASLAK" filigranı ve uyarı bandı çizilir. */
  isDraft?: boolean
}

const BRAND: [number, number, number] = [20, 61, 107] // #143d6b
const MUTED: [number, number, number] = [110, 110, 110]
const LINE: [number, number, number] = [210, 214, 220]

function fmt(n: number): string {
  return (Number(n) || 0).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "-"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("tr-TR")
}

function scenarioLabel(t: GibDocKind): string {
  if (t === "E_INVOICE") return "TICARIFATURA"
  if (t === "E_ARCHIVE") return "EARSIVFATURA"
  return "-"
}

function docTitle(t: GibDocKind): string {
  if (t === "E_INVOICE") return "e-FATURA"
  if (t === "E_ARCHIVE") return "e-ARŞİV FATURA"
  return "FATURA"
}

// --- Türkçe rakam → yazı (Yalnız ... satırı için) ---
const ONES = ["", "BİR", "İKİ", "ÜÇ", "DÖRT", "BEŞ", "ALTI", "YEDİ", "SEKİZ", "DOKUZ"]
const TENS = ["", "ON", "YİRMİ", "OTUZ", "KIRK", "ELLİ", "ALTMIŞ", "YETMİŞ", "SEKSEN", "DOKSAN"]
const SCALES = ["", "BİN", "MİLYON", "MİLYAR", "TRİLYON"]

function threeDigitsToWords(n: number): string {
  const parts: string[] = []
  const h = Math.floor(n / 100)
  const t = Math.floor((n % 100) / 10)
  const o = n % 10
  if (h > 0) parts.push(h === 1 ? "YÜZ" : `${ONES[h]} YÜZ`)
  if (t > 0) parts.push(TENS[t])
  if (o > 0) parts.push(ONES[o])
  return parts.join(" ").trim()
}

function integerToTurkishWords(value: number): string {
  let n = Math.floor(Math.abs(value))
  if (n === 0) return "SIFIR"
  const groups: number[] = []
  while (n > 0) {
    groups.push(n % 1000)
    n = Math.floor(n / 1000)
  }
  const words: string[] = []
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]
    if (g === 0) continue
    // "BİR BİN" yerine "BİN" yazılır (yalnız binler basamağında).
    if (i === 1 && g === 1) {
      words.push(SCALES[i])
    } else {
      words.push(`${threeDigitsToWords(g)} ${SCALES[i]}`.trim())
    }
  }
  return words.join(" ").replace(/\s+/g, " ").trim()
}

function amountInWords(amount: number, currency = "TRY"): string {
  const safe = Number(amount) || 0
  const lira = Math.floor(safe)
  const kurus = Math.round((safe - lira) * 100)
  const curLabel = currency === "TRY" ? "TL" : currency
  const liraWords = integerToTurkishWords(lira)
  if (kurus > 0) {
    return `Yalnız: ${liraWords} ${curLabel} ${integerToTurkishWords(kurus)} KR`
  }
  return `Yalnız: ${liraWords} ${curLabel}`
}

function drawWatermark(doc: jsPDF, pageW: number, pageH: number) {
  const g = (doc as any).GState
  if (typeof g === "function") {
    ;(doc as any).setGState(new g({ opacity: 0.08 }))
  }
  doc.setTextColor(20, 61, 107)
  doc.setFont(TURKISH_PDF_FONT, "bold")
  doc.setFontSize(90)
  doc.text("TASLAK", pageW / 2, pageH / 2, { align: "center", angle: 40 })
  if (typeof g === "function") {
    ;(doc as any).setGState(new g({ opacity: 1 }))
  }
  doc.setTextColor(0, 0, 0)
}

/**
 * GİB düzeninde taslak fatura PDF'i üretir ve Buffer döndürür (server-side).
 */
export async function generateGibInvoicePdfBuffer(data: GibInvoiceData): Promise<Buffer> {
  const isDraft = data.isDraft !== false
  const doc = new jsPDF({ unit: "mm", format: "a4" })
  await registerTurkishFont(doc)
  const FONT = TURKISH_PDF_FONT
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const marginX = 14
  const rightX = pageW - marginX

  if (isDraft) drawWatermark(doc, pageW, pageH)

  // --- Üst uyarı bandı (taslak) ---
  let topY = 12
  if (isDraft) {
    doc.setFillColor(255, 247, 237)
    doc.setDrawColor(245, 158, 11)
    doc.setLineWidth(0.3)
    doc.roundedRect(marginX, topY, pageW - marginX * 2, 8, 1, 1, "FD")
    doc.setFont(FONT, "bold")
    doc.setFontSize(8.5)
    doc.setTextColor(146, 64, 14)
    doc.text(
      "TASLAK — Bu bir ön izlemedir, mali/yasal değeri yoktur. Resmî belge, fatura resmileştirildikten sonra GİB tarafından üretilir.",
      pageW / 2,
      topY + 5.2,
      { align: "center" },
    )
    doc.setTextColor(0, 0, 0)
    topY += 12
  } else {
    topY = 16
  }

  // GİB düzeninde sol üst blok belgeyi DÜZENLEYEN (satıcı), "SAYIN" kutusu ise
  // belgenin muhatabı (alıcı) taraftır. Alış faturasını tedarikçi düzenler,
  // firmamız alıcıdır — bu yüzden taraflar fatura tipine göre yer değiştirir.
  // (Aksi hâlde alış faturası, kendimizi satıcı gösteren yanlış bir belge olurdu.)
  const isPurchase = data.type === "PURCHASE"
  const issuer: GibInvoiceParty = isPurchase
    ? data.counterparty || { name: "(tedarikçi seçilmedi)" }
    : data.company
  const recipient: GibInvoiceParty | null = isPurchase ? data.company : data.counterparty || null

  // --- Düzenleyen (satıcı) — sol üst ---
  doc.setFont(FONT, "bold")
  doc.setFontSize(14)
  doc.setTextColor(...BRAND)
  const companyNameLines = doc.splitTextToSize(issuer.name || "-", 105) as string[]
  doc.text(companyNameLines, marginX, topY + 4)
  doc.setTextColor(0, 0, 0)

  let leftY = topY + 4 + companyNameLines.length * 5.5 + 1
  doc.setFont(FONT, "normal")
  doc.setFontSize(8.5)
  doc.setTextColor(...MUTED)
  const companyLines: string[] = []
  if (issuer.taxOffice || issuer.taxNumber) {
    companyLines.push(
      `${issuer.taxOffice ? issuer.taxOffice + " VD - " : ""}VKN/TCKN: ${issuer.taxNumber || "-"}`,
    )
  }
  if (issuer.address) companyLines.push(issuer.address)
  const companyLoc = [issuer.district, issuer.city].filter(Boolean).join(" / ")
  if (companyLoc) companyLines.push(companyLoc)
  if (issuer.phone) companyLines.push(`Tel: ${issuer.phone}`)
  if (issuer.email) companyLines.push(`E-Posta: ${issuer.email}`)
  companyLines.forEach((ln) => {
    const wrapped = doc.splitTextToSize(ln, 105) as string[]
    doc.text(wrapped, marginX, leftY)
    leftY += wrapped.length * 4.2
  })
  doc.setTextColor(0, 0, 0)

  // --- Belge bilgi kutusu — sağ üst ---
  const boxW = 66
  const boxX = rightX - boxW
  const boxY = topY
  doc.setDrawColor(...LINE)
  doc.setLineWidth(0.3)
  doc.setFillColor(...BRAND)
  doc.rect(boxX, boxY, boxW, 9, "F")
  doc.setFont(FONT, "bold")
  doc.setFontSize(12)
  doc.setTextColor(255, 255, 255)
  doc.text(docTitle(data.invoiceType), boxX + boxW / 2, boxY + 6, { align: "center" })
  doc.setTextColor(0, 0, 0)

  const infoRows: Array<[string, string]> = [
    ["Senaryo", scenarioLabel(data.invoiceType)],
    ["Fatura Tipi", data.type === "RETURN" ? "IADE" : "SATIS"],
    ["Fatura No", data.invoiceNo || "(otomatik atanacak)"],
    ["Fatura Tarihi", fmtDate(data.date)],
  ]
  if (data.dueDate) infoRows.push(["Vade Tarihi", fmtDate(data.dueDate)])
  infoRows.push(["ETTN", data.ettn || (isDraft ? "(taslak — henüz yok)" : "-")])

  let infoY = boxY + 9
  const rowH = 6.4
  doc.setFontSize(8)
  infoRows.forEach(([label, value], i) => {
    if (i % 2 === 1) {
      doc.setFillColor(244, 246, 249)
      doc.rect(boxX, infoY, boxW, rowH, "F")
    }
    doc.setDrawColor(...LINE)
    doc.rect(boxX, infoY, boxW, rowH)
    doc.setFont(FONT, "bold")
    doc.setTextColor(...MUTED)
    doc.text(label, boxX + 1.6, infoY + 4.3)
    doc.setFont(FONT, "normal")
    doc.setTextColor(0, 0, 0)
    const val = doc.splitTextToSize(value, boxW - 24)[0] as string
    doc.text(val, boxX + boxW - 1.6, infoY + 4.3, { align: "right" })
    infoY += rowH
  })

  // --- Muhatap (SAYIN) kutusu — her zaman alıcı taraf ---
  const partyY = Math.max(leftY, infoY) + 4
  const partyLabel = "SAYIN (ALICI)"
  const cp = recipient
  const partyLines: string[] = []
  if (cp) {
    if (cp.taxOffice || cp.taxNumber) {
      partyLines.push(
        `${cp.taxOffice ? cp.taxOffice + " VD - " : ""}VKN/TCKN: ${cp.taxNumber || "-"}`,
      )
    }
    if (cp.address) partyLines.push(cp.address)
    const loc = [cp.district, cp.city].filter(Boolean).join(" / ")
    if (loc) partyLines.push(loc)
    if (cp.phone) partyLines.push(`Tel: ${cp.phone}`)
    if (cp.email) partyLines.push(`E-Posta: ${cp.email}`)
  }
  const partyBoxH = 8 + Math.max(partyLines.length, 1) * 4.4 + 4
  doc.setDrawColor(...LINE)
  doc.setFillColor(248, 249, 251)
  doc.roundedRect(marginX, partyY, pageW - marginX * 2, partyBoxH, 1, 1, "FD")
  doc.setFont(FONT, "bold")
  doc.setFontSize(8)
  doc.setTextColor(...MUTED)
  doc.text(partyLabel, marginX + 3, partyY + 5)
  doc.setFontSize(10.5)
  doc.setTextColor(0, 0, 0)
  doc.text(cp?.name || "(cari seçilmedi)", marginX + 3, partyY + 10)
  doc.setFont(FONT, "normal")
  doc.setFontSize(8.5)
  doc.setTextColor(...MUTED)
  let py = partyY + 14.5
  partyLines.forEach((ln) => {
    const wrapped = doc.splitTextToSize(ln, pageW - marginX * 2 - 6) as string[]
    doc.text(wrapped, marginX + 3, py)
    py += wrapped.length * 4.2
  })
  doc.setTextColor(0, 0, 0)

  // --- Kalem tablosu (GİB kolonları) ---
  const tableStartY = partyY + partyBoxH + 5
  const body = data.items.map((it, i) => [
    String(i + 1),
    it.description || "-",
    `${fmt(it.quantity)} ${(it.unit || "").toString()}`.trim(),
    fmt(it.unitPrice),
    it.discountAmount > 0 ? fmt(it.discountAmount) : "-",
    // KDV oranı; tevkifat varsa altına "Tevk.%X" satırı eklenir.
    (Number(it.withholdingRate) || 0) > 0
      ? `%${Number(it.vatRate) || 0}\nTevk.%${Number(it.withholdingRate)}`
      : `%${Number(it.vatRate) || 0}`,
    fmt(it.vatAmount),
    fmt(it.lineNet),
  ])

  autoTable(doc, {
    startY: tableStartY,
    head: [[
      "Sıra",
      "Mal / Hizmet",
      "Miktar",
      "Birim Fiyat",
      "İskonto",
      "KDV",
      "KDV Tutarı",
      "Mal Hizmet Tutarı",
    ]],
    body,
    theme: "grid",
    styles: {
      font: FONT,
      fontSize: 8,
      cellPadding: 2,
      lineColor: LINE,
      lineWidth: 0.2,
      textColor: [30, 30, 30],
    },
    headStyles: {
      font: FONT,
      fillColor: BRAND,
      textColor: 255,
      fontStyle: "bold",
      fontSize: 8,
      halign: "center",
    },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: "auto" },
      2: { cellWidth: 22, halign: "right" },
      3: { cellWidth: 24, halign: "right" },
      4: { cellWidth: 20, halign: "right" },
      5: { cellWidth: 14, halign: "center" },
      6: { cellWidth: 22, halign: "right" },
      7: { cellWidth: 28, halign: "right" },
    },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    margin: { left: marginX, right: marginX },
  })

  // --- Toplamlar bloğu (sağ) ---
  const t = data.totals
  const afterTableY = (doc as any).lastAutoTable.finalY + 6
  const totalsRows: Array<[string, string, boolean]> = [
    ["Mal Hizmet Toplam Tutarı", `${fmt(t.grossTotal)} ${data.currency === "TRY" ? "TL" : data.currency || "TL"}`, false],
  ]
  const discountTotal = (t.lineDiscountTotal || 0) + (t.globalDiscount || 0)
  if (discountTotal > 0) totalsRows.push(["Toplam İskonto", `${fmt(discountTotal)} TL`, false])
  if ((t.globalCharge || 0) > 0)
    totalsRows.push(["Fatura Altı İlave", `${fmt(t.globalCharge || 0)} TL`, false])
  totalsRows.push(["KDV Matrahı", `${fmt(t.netAmount)} TL`, false])
  totalsRows.push(["Hesaplanan KDV", `${fmt(t.vatAmount)} TL`, false])
  if ((t.exciseAmount || 0) > 0) totalsRows.push(["ÖTV", `${fmt(t.exciseAmount)} TL`, false])
  if ((t.otherTaxAmount || 0) > 0) totalsRows.push([t.otherTaxLabel || "Diğer Vergiler", `${fmt(t.otherTaxAmount)} TL`, false])
  const vergilerDahil = t.netAmount + t.vatAmount + (t.exciseAmount || 0) + (t.otherTaxAmount || 0)
  totalsRows.push(["Vergiler Dahil Toplam Tutar", `${fmt(vergilerDahil)} TL`, false])
  if ((t.withholdingAmount || 0) > 0) {
    const wRate = t.vatAmount > 0 ? Math.round((t.withholdingAmount / t.vatAmount) * 100) : 0
    totalsRows.push([`KDV Tevkifatı${wRate ? ` (%${wRate})` : ""}`, `- ${fmt(t.withholdingAmount)} TL`, false])
  }
  if ((t.rounding || 0) !== 0)
    totalsRows.push(["Yuvarlama", `${(t.rounding || 0) > 0 ? "" : "- "}${fmt(Math.abs(t.rounding || 0))} TL`, false])
  totalsRows.push(["Ödenecek Tutar", `${fmt(t.totalAmount)} TL`, true])

  const totalsW = 92
  const totalsX = rightX - totalsW
  let ty = afterTableY
  doc.setFontSize(9)
  totalsRows.forEach(([label, value, emphasize]) => {
    const h = emphasize ? 8 : 6
    if (emphasize) {
      doc.setFillColor(...BRAND)
      doc.rect(totalsX, ty, totalsW, h, "F")
      doc.setTextColor(255, 255, 255)
      doc.setFont(FONT, "bold")
      doc.setFontSize(10)
    } else {
      doc.setDrawColor(...LINE)
      doc.rect(totalsX, ty, totalsW, h)
      doc.setTextColor(...MUTED)
      doc.setFont(FONT, "normal")
      doc.setFontSize(9)
    }
    doc.text(label, totalsX + 2, ty + (emphasize ? 5.4 : 4.2))
    doc.setTextColor(emphasize ? 255 : 0, emphasize ? 255 : 0, emphasize ? 255 : 0)
    if (!emphasize) doc.setFont(FONT, "bold")
    doc.text(value, totalsX + totalsW - 2, ty + (emphasize ? 5.4 : 4.2), { align: "right" })
    ty += h
  })
  doc.setTextColor(0, 0, 0)

  // --- Yalnız (yazıyla) ---
  doc.setFont(FONT, "bold")
  doc.setFontSize(9)
  const words = amountInWords(t.totalAmount, data.currency)
  const wordsLines = doc.splitTextToSize(words, totalsX - marginX - 4) as string[]
  doc.text(wordsLines, marginX, afterTableY + 4)

  // --- Notlar ---
  let notesY = Math.max(ty, afterTableY + 4 + wordsLines.length * 4.5) + 8
  if (data.notes && data.notes.trim()) {
    doc.setFont(FONT, "bold")
    doc.setFontSize(8.5)
    doc.setTextColor(...MUTED)
    doc.text("Notlar", marginX, notesY)
    doc.setFont(FONT, "normal")
    doc.setTextColor(30, 30, 30)
    const noteLines = doc.splitTextToSize(data.notes.trim(), pageW - marginX * 2) as string[]
    doc.text(noteLines, marginX, notesY + 4.5)
    notesY += 4.5 + noteLines.length * 4.2
  }
  doc.setTextColor(0, 0, 0)

  // --- Alt bilgi ---
  doc.setFont(FONT, "normal")
  doc.setFontSize(7.5)
  doc.setTextColor(...MUTED)
  const footer = isDraft
    ? `TASLAK — ${new Date().toLocaleString("tr-TR")} · Kobipo Ön Muhasebe`
    : `${new Date().toLocaleString("tr-TR")} · Kobipo Ön Muhasebe`
  doc.text(footer, marginX, pageH - 8)
  doc.setTextColor(0, 0, 0)

  return Buffer.from(doc.output("arraybuffer"))
}
