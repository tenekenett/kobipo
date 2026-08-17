/**
 * PDF üreticisi — liste ve rapor tabloları.
 *
 * `lib/pdf/*` altındaki belge PDF'lerinden (fatura, bordro) ayrı: onlar tek bir
 * belgeyi sabit bir yerleşimle basar, bu ise herhangi bir tabloyu jenerik olarak
 * basar. Ortak nokta Türkçe font — `registerTurkishFont` olmadan jsPDF'in
 * WinAnsi helvetica'sı "ş, ğ, ı, İ" karakterlerini bozuyor.
 */

import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { registerTurkishFont, TURKISH_PDF_FONT } from "@/lib/pdf/unicode-font"
import type { ExportColumn, ExportColumnType, ExportDataset, ExportRow, ExportSection } from "./types"
import { columnAlign, formatCellText, resolveTotals } from "./values"

const MARGIN = 12
/** Bu sayıdan fazla kolon dikey A4'e sığmıyor; otomatik yatığa geçilir. */
const LANDSCAPE_COLUMN_THRESHOLD = 6
/** `width` verilmeyen kolonun (ürün adı, ünvan) oransal payı. */
const FLEX_WIDTH = 50
/**
 * Denenecek gövde punto'ları. Tablo 7,5'te sığmıyorsa sarmak yerine küçültülür:
 * 6 punto bir tutarı hâlâ okunur kılar, iki satıra bölünmüş bir tutar okunmaz.
 */
const FONT_SIZE_STEPS = [7.5, 7, 6.5, 6, 5.5]
const BODY_FONT_SIZE = FONT_SIZE_STEPS[0]
const CELL_PADDING = 1.8
/** Hücre içeriğinin iki yanındaki dolgu + yuvarlama payı. */
const CELL_SLACK = CELL_PADDING * 2 + 0.8
/**
 * Metin kolonu kendi en uzun içeriğini değil, en fazla bu kadarını "zorunlu"
 * sayar; gerisi satır kaydırılır. Adres/ünvan uzundur ve kayması normaldir.
 */
const TEXT_MIN_CAP = 34

/**
 * Sarılması KABUL EDİLEMEZ kolonlar. "-154.378,05" tutarının iki satıra bölünüp
 * "-154.378,0 / 5" görünmesi okuyanı yanıltır (ilk bakışta farklı bir sayı);
 * tarih de aynı şekilde. Metin kolonları serbestçe sarılabilir.
 */
const NON_WRAPPING: ExportColumnType[] = ["money", "number", "qty", "percent", "date", "datetime"]

function mustNotWrap(column: ExportColumn): boolean {
  return NON_WRAPPING.includes(column.type ?? "text")
}

/** Bir kolonun en geniş hücresinin gerçek genişliği (mm). */
function measureColumn(
  doc: jsPDF,
  column: ExportColumn,
  rows: ExportRow[],
  totals: ExportRow | null,
  fontSize: number,
): number {
  doc.setFontSize(fontSize)
  let widest = 0

  // Gövde — normal font. Uzunluk, genişlik için iyi bir vekil (DejaVu Sans
  // rakamları eş genişlikte); 5.000 satırın hepsini ölçmek yerine en uzun
  // birkaç adayı ölçmek yeterli.
  doc.setFont(TURKISH_PDF_FONT, "normal")
  const values = rows.map((row) => formatCellText(row[column.key], column.type))
  for (const value of values.sort((a, b) => b.length - a.length).slice(0, 3)) {
    widest = Math.max(widest, doc.getTextWidth(value))
  }

  // Başlık ve toplam satırı KALIN basılıyor; kalın metin daha geniştir. Normal
  // fontla ölçmek "-154.570,05" toplamının iki satıra bölünmesine yol açıyordu.
  doc.setFont(TURKISH_PDF_FONT, "bold")
  if (totals && column.key in totals) {
    widest = Math.max(widest, doc.getTextWidth(formatCellText(totals[column.key], column.type)))
  }
  // Başlık sarılabilir ("Bakiye (Alacak)" iki satır olur) ama en uzun TEK
  // kelimesi sığmak zorunda, yoksa harf harf kırılır.
  for (const word of column.label.split(/\s+/)) {
    widest = Math.max(widest, doc.getTextWidth(word))
  }
  doc.setFont(TURKISH_PDF_FONT, "normal")

  return widest + CELL_SLACK
}

/**
 * Kolon genişlikleri. `ExportColumn.width` mutlak milimetre DEĞİL, artan alanın
 * paylaşımında kullanılan oransal ağırlıktır.
 *
 * İki kural:
 *  1. Sayı/tarih kolonları içeriklerinin TAM genişliğini alır — asla sarılmaz.
 *  2. Kalan alan, metin kolonlarına ağırlıklarına göre dağıtılır.
 *
 * Toplam daima sayfa genişliğine eşitlenir: autoTable `tableWidth: "auto"` ile
 * tabloyu sayfaya yayar ve sabit genişliklerin toplamı tutmazsa "could not fit
 * page" uyarısı verip yerleşimi bozar.
 */
function resolveColumnWidths(
  doc: jsPDF,
  section: ExportSection,
  totals: ExportRow | null,
  available: number,
): { widths: number[]; fontSize: number } {
  const columns = section.columns

  const minimumsAt = (fontSize: number) =>
    columns.map((column) => {
      const measured = measureColumn(doc, column, section.rows, totals, fontSize)
      return mustNotWrap(column) ? measured : Math.min(measured, TEXT_MIN_CAP)
    })

  // 1) Tabanların sığdığı en büyük punto'yu bul. 15 kolonlu ürün listesi 8 haneli
  //    tutarlarla 7,5'te sığmaz; küçültmek sarmaktan iyidir.
  let fontSize = BODY_FONT_SIZE
  let minimums = minimumsAt(fontSize)
  for (const candidate of FONT_SIZE_STEPS) {
    fontSize = candidate
    minimums = minimumsAt(candidate)
    if (minimums.reduce((sum, value) => sum + value, 0) < available) break
  }

  const minTotal = minimums.reduce((sum, value) => sum + value, 0)

  // 2) En küçük punto'da bile sığmıyorsa orantılı küçült — bu noktada sarılma
  //    kaçınılmaz, en azından sayfa taşmaz.
  if (minTotal >= available) {
    const factor = available / minTotal
    const scaled = minimums.map((value) => value * factor)
    scaled[scaled.length - 1] += available - scaled.reduce((sum, value) => sum + value, 0)
    return { widths: scaled, fontSize }
  }

  // 3) Artan alanı esnek (metin) kolonlara ağırlıkla dağıt; hiç metin kolonu
  //    yoksa herkese dağıt.
  const flexible = columns.map((column) => !mustNotWrap(column))
  const anyFlexible = flexible.some(Boolean)
  const weights = columns.map((column, index) =>
    !anyFlexible || flexible[index] ? column.width ?? FLEX_WIDTH : 0,
  )
  const weightTotal = weights.reduce((sum, value) => sum + value, 0)
  const leftover = available - minTotal

  const widths = minimums.map((value, index) =>
    weightTotal > 0 ? value + (leftover * weights[index]) / weightTotal : value,
  )
  // Ondalık artığı son kolona ver ki toplam birebir `available` olsun.
  widths[widths.length - 1] += available - widths.reduce((sum, value) => sum + value, 0)
  return { widths, fontSize }
}

function resolveOrientation(dataset: ExportDataset): "portrait" | "landscape" {
  if (dataset.orientation) return dataset.orientation
  const widest = dataset.sections.reduce((max, section) => Math.max(max, section.columns.length), 0)
  return widest > LANDSCAPE_COLUMN_THRESHOLD ? "landscape" : "portrait"
}

const META_FONT_SIZE = 8
const META_LINE_HEIGHT = 4

type HeaderLayout = {
  /** Sağ üstteki başlık — SARILMIŞ satırlar (uzun başlık sayfadan taşmasın). */
  titleLines: string[]
  titleWidth: number
  /** Sol üstteki firma unvanı — sarılmış, KIRPILMAMIŞ satırlar. */
  companyLines: string[]
  identityLines: string[]
  identityY: number
  filterLines: string[]
  filterY: number
  separatorY: number
  /** Tabloların/başlıkların başlayabileceği ilk y. */
  contentTop: number
}

/**
 * Antet yüksekliğini İÇERİĞE göre hesaplar.
 *
 * Sabit yükseklik kullanılıyordu ve filtre satırı (ör. "Cari: … · Dönem: … ·
 * Hareket sayısı: 34") ayırıcı çizginin ALTINA düşüp bölüm başlığının üstüne
 * biniyordu. Filtreler ayrıca sarılabildiği için yükseklik ancak ölçülerek
 * bilinir; bu yüzden tek yerden hesaplanıp hem çizime hem autoTable'ın üst
 * boşluğuna (sayfa kırıldığında da geçerli olsun diye) veriliyor.
 */
function computeHeaderLayout(doc: jsPDF, dataset: ExportDataset): HeaderLayout {
  const pageWidth = doc.internal.pageSize.getWidth()
  const contentWidth = pageWidth - MARGIN * 2

  // Başlık ve unvan İKİ SÜTUN gibi davranır: her biri kendi payında sarılır.
  // Eskiden başlık tek satır sağa hizalı çiziliyordu — uzun bir rapor adı
  // sayfanın SOLUNA taşıyordu (ölçüldü: x = -24mm) — ve unvan `slice(0,1)` ile
  // tek satıra kırpılıp bilgi sessizce kayboluyordu.
  const titleMaxWidth = contentWidth * 0.5
  doc.setFont(TURKISH_PDF_FONT, "bold")
  doc.setFontSize(14)
  const titleLines = doc.splitTextToSize(dataset.title || "", titleMaxWidth) as string[]
  const titleWidth = titleLines.reduce((max, line) => Math.max(max, doc.getTextWidth(line)), 0)

  doc.setFontSize(12)
  const companyMaxWidth = Math.max(40, contentWidth - titleWidth - 8)
  const companyLines = doc.splitTextToSize(
    dataset.company.name || "",
    companyMaxWidth,
  ) as string[]

  const identity =
    [
      dataset.company.taxNumber ? `VKN/TCKN: ${dataset.company.taxNumber}` : null,
      dataset.company.city,
      dataset.company.phone,
    ]
      .filter(Boolean)
      .join("  ·  ") || null

  doc.setFont(TURKISH_PDF_FONT, "normal")
  doc.setFontSize(META_FONT_SIZE)
  const identityLines = identity ? (doc.splitTextToSize(identity, contentWidth) as string[]) : []
  const filters = dataset.filters?.filter(Boolean) ?? []
  const filterLines =
    filters.length > 0
      ? (doc.splitTextToSize(filters.join("  ·  "), contentWidth) as string[])
      : []

  // Dikey akış: iki sütunun DAHA UZUN olanı belirler.
  const firstBaseline = MARGIN + 4
  const leftBottom = firstBaseline + (companyLines.length - 1) * 5.5
  const rightBottom = firstBaseline + (titleLines.length - 1) * 6
  let y = Math.max(leftBottom, rightBottom)

  const identityY = y + 6
  if (identityLines.length > 0) y = identityY + (identityLines.length - 1) * META_LINE_HEIGHT

  const filterY = y + (identityLines.length > 0 ? 5 : 6)
  if (filterLines.length > 0) y = filterY + (filterLines.length - 1) * META_LINE_HEIGHT

  const separatorY = y + 4
  return {
    titleLines,
    titleWidth,
    companyLines,
    identityLines,
    identityY,
    filterLines,
    filterY,
    separatorY,
    contentTop: separatorY + 6,
  }
}

function drawHeader(doc: jsPDF, dataset: ExportDataset, layout: HeaderLayout) {
  const right = doc.internal.pageSize.getWidth() - MARGIN

  // Başlık: sarılmış satırlar sağa hizalı basılır (her satır kendi genişliğinde).
  doc.setFontSize(14)
  doc.setFont(TURKISH_PDF_FONT, "bold")
  layout.titleLines.forEach((line, i) => {
    doc.text(line, right, MARGIN + 4 + i * 6, { align: "right" })
  })

  // Unvan: kalan payda, kaç satır sürerse o kadar (kırpma yok).
  doc.setFontSize(12)
  layout.companyLines.forEach((line, i) => {
    doc.text(line, MARGIN, MARGIN + 4 + i * 5.5)
  })

  doc.setFont(TURKISH_PDF_FONT, "normal")
  doc.setFontSize(META_FONT_SIZE)
  doc.setTextColor(90)

  layout.identityLines.forEach((line, i) => {
    doc.text(line, MARGIN, layout.identityY + i * META_LINE_HEIGHT)
  })
  if (layout.filterLines.length > 0) {
    doc.text(layout.filterLines, MARGIN, layout.filterY, { lineHeightFactor: 1.35 })
  }

  doc.setTextColor(0)
  doc.setDrawColor(210)
  doc.line(MARGIN, layout.separatorY, right, layout.separatorY)
}

function drawFooters(doc: jsPDF, dataset: ExportDataset) {
  const pageCount = doc.getNumberOfPages()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page)
    doc.setFont(TURKISH_PDF_FONT, "normal")
    doc.setFontSize(7.5)
    doc.setTextColor(130)
    doc.text(
      `Oluşturma: ${formatCellText(dataset.generatedAt ?? new Date(), "datetime")}`,
      MARGIN,
      pageHeight - 7,
    )
    doc.text(`Sayfa ${page} / ${pageCount}`, pageWidth - MARGIN, pageHeight - 7, { align: "right" })
    doc.setTextColor(0)
  }
}

function drawSection(
  doc: jsPDF,
  section: ExportSection,
  startY: number,
  contentTop: number,
): number {
  const totals = resolveTotals(section)

  const body = section.rows.map((row) =>
    section.columns.map((column) => formatCellText(row[column.key], column.type)),
  )

  const foot = totals
    ? [
        section.columns.map((column, index) => {
          if (column.key in totals) return formatCellText(totals[column.key], column.type)
          return index === 0 ? "TOPLAM" : ""
        }),
      ]
    : undefined

  const available = doc.internal.pageSize.getWidth() - MARGIN * 2
  const { widths, fontSize } = resolveColumnWidths(doc, section, totals, available)
  const columnStyles: Record<number, { halign: "left" | "center" | "right"; cellWidth: number }> = {}
  section.columns.forEach((column, index) => {
    columnStyles[index] = { halign: columnAlign(column), cellWidth: widths[index] }
  })

  autoTable(doc, {
    startY,
    head: [section.columns.map((column) => column.label)],
    body: body.length > 0 ? body : [[{ content: "Kayıt bulunamadı", colSpan: section.columns.length }]],
    foot,
    // Ölçüm bu punto ve dolguyla yapıldı; autoTable aynısını kullanmak zorunda.
    styles: {
      font: TURKISH_PDF_FONT,
      fontSize,
      cellPadding: CELL_PADDING,
      overflow: "linebreak",
    },
    headStyles: { font: TURKISH_PDF_FONT, fontStyle: "bold", fillColor: [37, 99, 235], textColor: 255 },
    footStyles: { font: TURKISH_PDF_FONT, fontStyle: "bold", fillColor: [241, 245, 249], textColor: 20 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles,
    // Sayfa kırıldığında yeni sayfanın tablosu antetin altından başlasın.
    margin: { left: MARGIN, right: MARGIN, top: contentTop },
    tableWidth: "auto",
  })

  return (doc as any).lastAutoTable.finalY as number
}

export async function buildPdf(dataset: ExportDataset): Promise<Buffer> {
  const doc = new jsPDF({ orientation: resolveOrientation(dataset), unit: "mm", format: "a4" })
  await registerTurkishFont(doc)

  const pageHeight = doc.internal.pageSize.getHeight()
  // Antet yüksekliği içeriğe bağlı (uzun/sarılan filtre satırı) — önce ölç,
  // sonra hem tabloların başlangıcı hem sayfa üst boşluğu olarak kullan.
  const header = computeHeaderLayout(doc, dataset)
  let cursorY = header.contentTop

  dataset.sections.forEach((section, index) => {
    if (index > 0) {
      cursorY += 8
      // Bölüm başlığı sayfanın dibinde kalıp tablosu diğer sayfaya düşmesin.
      if (cursorY > pageHeight - 45) {
        doc.addPage()
        cursorY = header.contentTop
      }
    }

    if (section.title && dataset.sections.length > 1) {
      doc.setFont(TURKISH_PDF_FONT, "bold")
      doc.setFontSize(10)
      doc.text(section.title, MARGIN, cursorY)
      cursorY += 4
    }

    cursorY = drawSection(doc, section, cursorY, header.contentTop)
  })

  if (dataset.note) {
    doc.setFont(TURKISH_PDF_FONT, "normal")
    doc.setFontSize(8)
    doc.setTextColor(180, 83, 9)
    const noteY = Math.min(cursorY + 8, pageHeight - 14)
    doc.text(doc.splitTextToSize(dataset.note, doc.internal.pageSize.getWidth() - MARGIN * 2) as string[], MARGIN, noteY)
    doc.setTextColor(0)
  }

  // Antet her sayfaya sonradan basılır: autoTable sayfa kırdığında `didDrawPage`
  // ile uğraşmak yerine tüm sayfalar oluştuktan sonra tek yerden çiziliyor.
  const pageCount = doc.getNumberOfPages()
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page)
    drawHeader(doc, dataset, header)
  }
  drawFooters(doc, dataset)

  return Buffer.from(doc.output("arraybuffer"))
}
