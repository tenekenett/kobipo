import type { Content, TDocumentDefinitions } from "pdfmake/interfaces"
import { pdfFonts } from "./font"
import { COLORS, FONT, FS, PAGE, mm } from "./theme"

/**
 * Tüm belgelerin ortak çerçevesi: A4, kenar boşlukları, sabit altlık
 * (üretim notu + "Sayfa x / y") ve varsayılan yazı biçimi.
 *
 * Sayfa sonu YÖNETİLMEZ, motora bırakılır: içerik uzarsa pdfmake yeni sayfa
 * açar, altlık her sayfada tekrar basılır, tablo başlığı (headerRows) yeni
 * sayfada yeniden çizilir. Eski jsPDF üreticilerinde bu iş elle
 * (`if (blockY + 20 > pageHeight - 20) addPage()`) yapılıyordu.
 */

export const CONTENT_WIDTH = 595.28 - 2 * PAGE.paddingHorizontal

export function buildDocDefinition({
  content,
  footerNote,
  title,
}: {
  content: Content[]
  /** Altlığın sol tarafı (ör. "Bu teklif … tarihinde oluşturulmuştur."). */
  footerNote?: string
  /** PDF meta başlığı (görüntüleyicinin sekme adı). */
  title?: string
}): TDocumentDefinitions {
  return {
    pageSize: "A4",
    pageMargins: [
      PAGE.paddingHorizontal,
      PAGE.paddingTop,
      PAGE.paddingHorizontal,
      PAGE.paddingBottom,
    ],
    info: title ? { title } : undefined,
    defaultStyle: { font: FONT, fontSize: FS.body, color: COLORS.text, lineHeight: 1.2 },
    styles: {
      docTitle: { fontSize: FS.title, bold: true },
      h1: { fontSize: FS.h1, bold: true },
      h2: { fontSize: FS.h2, bold: true },
      muted: { fontSize: FS.small, color: COLORS.muted },
      sub: { fontSize: FS.tiny, color: COLORS.muted },
    },
    footer: (currentPage: number, pageCount: number) => ({
      margin: [PAGE.paddingHorizontal, mm(4), PAGE.paddingHorizontal, 0],
      columns: [
        { text: footerNote || "", fontSize: FS.tiny, color: COLORS.muted },
        {
          text: `Sayfa ${currentPage} / ${pageCount}`,
          fontSize: FS.tiny,
          color: COLORS.muted,
          alignment: "right",
        },
      ],
    }),
    content,
  }
}

/** Başlıklı blok — bloklar arası tutarlı boşluk. */
export function section(title: string | null, body: Content, gap = mm(5)): Content {
  const parts: Content[] = []
  if (title) parts.push({ text: title, style: "h2", margin: [0, 0, 0, mm(1.5)] })
  parts.push(body)
  return { stack: parts, margin: [0, gap, 0, 0] }
}

/**
 * docDefinition → PDF Buffer.
 *
 * pdfmake CommonJS; dinamik import ile yükleniyor ki Next'in sunucu paketinde
 * harici (serverExternalPackages) kalabilsin.
 */
export async function renderPdf(dd: TDocumentDefinitions): Promise<Buffer> {
  const mod = await import("pdfmake")
  const PdfPrinter = (mod as any).default ?? mod
  const printer = new PdfPrinter(pdfFonts())
  const doc = printer.createPdfKitDocument(dd)

  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    doc.on("data", (c: Buffer) => chunks.push(c))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)
    doc.end()
  })
}
