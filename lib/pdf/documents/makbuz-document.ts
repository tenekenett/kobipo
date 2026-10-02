import type { Content } from "pdfmake/interfaces"
import { docTable } from "@/lib/pdf/doc/items-table"
import { CONTENT_WIDTH, buildDocDefinition, renderPdf, section } from "@/lib/pdf/doc/page-frame"
import { STAMP_MAX_HEIGHT_MM, type CompanyStamp } from "@/lib/company/stamp"
import { partyHeader, type PartyLike } from "@/lib/pdf/doc/party-box"
import { fmtDate } from "@/lib/pdf/doc/money"
import { softBreak } from "@/lib/pdf/doc/safe-text"
import { COLORS, FS, mm } from "@/lib/pdf/doc/theme"

/**
 * TAHSİLAT / ÖDEME MAKBUZU.
 *
 * Eski sürüm istemcide jsPDF ile çiziliyordu ve başlık genişliğini ölçüp firma
 * unvanını ona göre kırpmak gibi elle çakışma çözümleri içeriyordu
 * (`companyMaxW = max(70, titleLeftX - 22)`), cari adı tek satıra budanıyordu
 * (`slice(0,1)`). Artık akış tabanlı ve sunucu tarafında: ekrandan indirilen
 * makbuz ile sunucudan giden birebir aynı.
 */

export type MakbuzPdfData = {
  /** "Tahsilat" | "Ödeme" | "Gelir" | "Gider" */
  kind: string
  /**
   * Kıymetli evrak makbuzunda başlığa giren araç: "Çek" | "Senet".
   * Verilmezse kasa/banka makbuzu basılır ("TAHSİLAT MAKBUZU").
   */
  instrument?: string | null
  makbuzNo: string
  date: string | Date
  amount: number
  currency: string
  description?: string | null
  reference?: string | null
  paymentMethod: string
  /**
   * Paranın girdiği kasa/banka kanalı. Çek/senet makbuzunda YOKTUR: evrak teslim
   * alınmıştır ama henüz bir kanala girmemiştir; boş "Hesap" satırı basmak yerine
   * satır tamamen düşer.
   */
  account?: { name: string; bankName?: string | null } | null
  /** Araca özgü ek bilgi satırları (çek no, banka, vade, durum…). */
  extraRows?: Array<{ label: string; value: string }>
  company: PartyLike
  /** Firmanın kaşesi (`loadCompanyStamp`); yoksa imza alanı boş basılır. */
  stamp?: CompanyStamp | null
  cari?: { label: string; name: string; taxNumber?: string | null } | null
  invoices: Array<{ invoiceNo: string; amount: number }>
}

/** "TAHSİLAT MAKBUZU" / "ÇEK TAHSİLAT MAKBUZU" — araç varsa başa gelir. */
const makbuzTitle = (data: Pick<MakbuzPdfData, "kind" | "instrument">) =>
  `${[data.instrument, data.kind].filter(Boolean).join(" ")} Makbuzu`

const money = (amount: number, currency = "TRY") =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency }).format(Number(amount) || 0)

/**
 * Makbuz başlığı: solda firma künyesi, sağda belge adı + numara + tarih. Kasa,
 * çek/senet ve virman makbuzu aynı başlığı basar.
 */
export function makbuzHeader(company: PartyLike, title: string, numberLine: string, date: string | Date): Content {
  return {
    columns: [
      { width: "*", ...(partyHeader(company) as any) },
      {
        width: mm(62),
        stack: [
          { text: title.toLocaleUpperCase("tr-TR"), style: "docTitle", alignment: "right" },
          { text: softBreak(numberLine), alignment: "right", margin: [0, mm(1), 0, 0] },
          { text: `Tarih: ${fmtDate(date)}`, alignment: "right", margin: [0, mm(1), 0, 0] },
        ],
      },
    ],
    columnGap: mm(6),
  }
}

const SIGNATURE_GAP = mm(14)

/**
 * Kaşenin basılacağı ölçü (pt): kaşenin kutusuna en-boy oranı korunarak sığar
 * (faturadaki `object-fit: contain` ile aynı), imza sütunundan ve yükseklik üst
 * sınırından (`STAMP_MAX_HEIGHT_MM`) taşmaz.
 */
export function stampDrawSize(stamp: CompanyStamp, maxWidth: number): { width: number; height: number } {
  const boxW = Math.min(stamp.boxWidthPt, maxWidth)
  const boxH = Math.min(stamp.boxHeightPt, mm(STAMP_MAX_HEIGHT_MM))
  const scale = Math.min(boxW / stamp.pixelWidth, boxH / stamp.pixelHeight)
  return { width: stamp.pixelWidth * scale, height: stamp.pixelHeight * scale }
}

/**
 * İmza alanları — akışın sonunda; çizgi hücre kenarlığından gelir, mutlak
 * koordinatlı `doc.line()` çağrısı yok.
 *
 * İki imza TEK tablonun satırlarıdır: kaşe bir tarafı uzatsa da satır yüksekliği
 * ortak olduğu için iki çizgi aynı hizada kalır. `stamp` verilirse firmanın kaşesi
 * o tarafın çizgisinin üstüne basılır (bkz. `lib/company/stamp.ts`).
 */
export function makbuzSignatures(
  left: string,
  right: string,
  stamp?: { image: CompanyStamp; side: "left" | "right" } | null,
): Content {
  const lineBelow = [false, false, false, true]
  const noBorder = [false, false, false, false]
  const columnWidth = (CONTENT_WIDTH - SIGNATURE_GAP) / 2

  const top = (side: "left" | "right") => {
    if (stamp?.side === side) {
      const size = stampDrawSize(stamp.image, columnWidth)
      return {
        image: stamp.image.dataUri,
        width: size.width,
        height: size.height,
        alignment: "center" as const,
        margin: [0, 0, 0, mm(1)],
        border: lineBelow,
      }
    }
    return { text: " ", margin: [0, mm(10), 0, 0], border: lineBelow }
  }
  const label = (text: string) => ({
    text,
    alignment: "center" as const,
    fontSize: FS.small,
    margin: [0, mm(1.5), 0, 0],
    border: noBorder,
  })
  const gap = { text: "", border: noBorder }

  return {
    // Kaşe bir sayfada, etiketi öbür sayfada kalmasın.
    unbreakable: true,
    margin: [0, mm(18), 0, 0],
    stack: [
      {
        table: {
          widths: ["*", SIGNATURE_GAP, "*"],
          body: [
            [top("left"), gap, top("right")],
            [label(left), gap, label(right)],
          ],
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0,
          hLineColor: () => COLORS.line,
          paddingLeft: () => 0,
          paddingRight: () => 0,
          paddingTop: () => 0,
          paddingBottom: () => 0,
        },
      },
    ],
  } as unknown as Content
}

export function buildMakbuzContent(data: MakbuzPdfData): Content[] {
  const isIncome = data.kind === "Tahsilat" || data.kind === "Gelir"
  const cur = data.currency || "TRY"

  const infoRows: Array<{ label: string; value: string }> = [
    { label: "Ödeme Yöntemi", value: data.paymentMethod },
  ]
  if (data.account) {
    infoRows.push({
      label: "Hesap",
      value: data.account.bankName
        ? `${data.account.name} · ${data.account.bankName}`
        : data.account.name,
    })
  }
  if (data.extraRows?.length) infoRows.push(...data.extraRows)
  if (data.reference) infoRows.push({ label: "Referans", value: data.reference })
  if (data.description?.trim()) {
    infoRows.push({ label: "Açıklama", value: data.description.trim() })
  }

  const content: Content[] = [
    makbuzHeader(data.company, makbuzTitle(data), `Makbuz No: ${data.makbuzNo}`, data.date),
  ]

  // Cari kutusu (varsa) — ad ve VKN iki sütunda, ikisi de kendi genişliğinde sarılır.
  if (data.cari) {
    content.push({
      table: {
        widths: ["*", "auto"],
        body: [
          [
            {
              stack: [
                { text: data.cari.label, bold: true, fontSize: FS.small },
                { text: softBreak(data.cari.name), fontSize: FS.h2, margin: [0, mm(1), 0, 0] },
              ],
              fillColor: COLORS.boxBg,
              margin: [mm(2), mm(2), mm(2), mm(2)],
            },
            {
              text: data.cari.taxNumber ? softBreak(`VKN/TCKN: ${data.cari.taxNumber}`) : "",
              fontSize: FS.small,
              alignment: "right",
              fillColor: COLORS.boxBg,
              margin: [mm(2), mm(2), mm(2), mm(2)],
            },
          ],
        ],
      },
      layout: {
        hLineWidth: () => 0,
        vLineWidth: () => 0,
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 0,
        paddingBottom: () => 0,
      },
      margin: [0, mm(6), 0, 0],
    })
  }

  // Tutar vurgusu.
  content.push({
    columns: [
      {
        width: "*",
        text: data.instrument
          ? `Teslim ${isIncome ? "Alınan" : "Edilen"} ${data.instrument} Tutarı`
          : isIncome
            ? "Tahsil Edilen Tutar"
            : "Ödenen Tutar",
        bold: true,
        fontSize: FS.h2,
      },
      {
        width: "auto",
        text: softBreak(money(data.amount, cur)),
        bold: true,
        fontSize: FS.title,
        alignment: "right",
      },
    ],
    columnGap: mm(4),
    margin: [0, mm(6), 0, 0],
  })

  content.push(
    section(
      null,
      docTable<{ label: string; value: string }>({
        columns: [
          { header: "Bilgi", width: 30, cell: (r) => r.label },
          { header: "Değer", width: 70, cell: (r) => r.value },
        ],
        rows: infoRows,
      }),
      mm(4),
    ),
  )

  if (data.invoices.length > 0) {
    content.push(
      section(
        "Eşleştiği Faturalar",
        docTable<{ invoiceNo: string; amount: number }>({
          columns: [
            { header: "Fatura No", width: 60, cell: (r) => r.invoiceNo },
            { header: "Tutar", width: 40, align: "right", cell: (r) => money(r.amount, cur) },
          ],
          rows: data.invoices,
        }),
        mm(6),
      ),
    )
  }

  // Makbuzu firma düzenler; kaşe firmanın tarafına basılır: tahsilatta parayı/evrakı
  // TESLİM ALAN, ödemede TESLİM EDEN firmadır.
  content.push(
    makbuzSignatures(
      "Teslim Eden",
      "Teslim Alan",
      data.stamp ? { image: data.stamp, side: isIncome ? "right" : "left" } : null,
    ),
  )

  return content
}

export function renderMakbuzPdf(data: MakbuzPdfData): Promise<Buffer> {
  return renderPdf(
    buildDocDefinition({
      title: `${makbuzTitle(data)} ${data.makbuzNo}`,
      footerNote: `${new Date().toLocaleString("tr-TR")} · Kobipo Ön Muhasebe`,
      content: buildMakbuzContent(data),
    }),
  )
}
