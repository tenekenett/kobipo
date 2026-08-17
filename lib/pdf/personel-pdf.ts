import type { Content } from "pdfmake/interfaces"
import { docTable } from "@/lib/pdf/doc/items-table"
import { buildDocDefinition, renderPdf, section, CONTENT_WIDTH } from "@/lib/pdf/doc/page-frame"
import { partyHeader, type PartyLike } from "@/lib/pdf/doc/party-box"
import { softBreak } from "@/lib/pdf/doc/safe-text"
import { COLORS, FS, mm } from "@/lib/pdf/doc/theme"

/**
 * Personel belgeleri: maaş pusulası, izin talep formu, zimmet teslim/iade formu.
 *
 * Dışa açık API korunur (`buildPayslipPdf`, `buildLeaveFormPdf`,
 * `buildAssetFormPdf`) — yalnız çizim motoru akış tabanlı kite geçti. Eski jsPDF
 * sürümünde firma unvanı başlık genişliği ölçülerek TEK SATIRA kırpılıyor
 * (`slice(0,1)`), adres 80 karakterde kesiliyordu (`slice(0, 80)`); bordroda iki
 * tablo sabit `margin`/`tableWidth` ile yan yana konumlandırılıyordu.
 */

const MONTHS = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
]

export type PdfCompany = {
  name: string
  taxNumber?: string | null
  address?: string | null
  city?: string | null
  phone?: string | null
}

export type PdfEmployee = {
  firstName: string
  lastName: string
  nationalId?: string | null
  position?: string | null
  department?: string | null
  iban?: string | null
}

const money = (n: number) =>
  `${Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`

const date = (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString("tr-TR") : "-")

/** Belge başlığı: solda firma künyesi, sağda belge adı. */
function header(company: PdfCompany, title: string): Content {
  const party: PartyLike = {
    name: company.name,
    taxNumber: company.taxNumber,
    address: company.address,
    city: company.city,
    phone: company.phone,
  }
  return {
    columns: [
      { width: "*", ...(partyHeader(party) as any) },
      { width: mm(62), text: title, style: "docTitle", alignment: "right" },
    ],
    columnGap: mm(6),
  }
}

/** Personel künyesi — etiket/değer iki sütun. */
function employeeBlock(emp: PdfEmployee): Content {
  const lines: string[] = []
  if (emp.nationalId) lines.push(`T.C.: ${emp.nationalId}`)
  const role = [emp.position, emp.department].filter(Boolean).join(" / ")
  if (role) lines.push(role)
  if (emp.iban) lines.push(`IBAN: ${emp.iban}`)

  return {
    columns: [
      { width: mm(28), text: "PERSONEL", bold: true, fontSize: FS.body },
      {
        width: "*",
        stack: [
          { text: softBreak(`${emp.firstName} ${emp.lastName}`), fontSize: FS.h2 },
          ...lines.map((l) => ({ text: softBreak(l), style: "muted" as const })),
        ],
      },
    ],
    columnGap: mm(4),
    margin: [0, mm(6), 0, 0],
  }
}

/** Etiket/değer tablosu (form satırları). */
function fieldTable(rows: Array<[string, string]>): Content {
  return docTable<{ label: string; value: string }>({
    columns: [
      { header: "Alan", width: 30, cell: (r) => r.label },
      { header: "Bilgi", width: 70, cell: (r) => r.value },
    ],
    rows: rows.map(([label, value]) => ({ label, value })),
  })
}

/** İmza alanları — çizgi tablo kenarlığından gelir, mutlak koordinat yok. */
function signatures(left: string, right: string): Content {
  const cell = (label: string) => ({
    table: {
      widths: ["*"],
      body: [
        [{ text: " ", margin: [0, mm(10), 0, 0] }],
        [
          {
            text: label,
            alignment: "center" as const,
            fontSize: FS.small,
            margin: [0, mm(1.5), 0, 0],
          },
        ],
      ],
    },
    layout: {
      hLineWidth: (i: number) => (i === 1 ? 0.5 : 0),
      vLineWidth: () => 0,
      hLineColor: () => COLORS.line,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  })

  return {
    columns: [
      { width: "*", ...cell(left) },
      { width: "*", ...cell(right) },
    ],
    columnGap: mm(14),
    margin: [0, mm(18), 0, 0],
  } as unknown as Content
}

const footerNote = () => `Oluşturma: ${new Date().toLocaleString("tr-TR")}`

// --------------------------- BORDRO / MAAŞ PUSULASI ---------------------------
export async function buildPayslipPdf(args: {
  company: PdfCompany
  employee: PdfEmployee
  periodYear: number
  periodMonth: number
  grossSalary: number
  bonus: number
  advance: number
  sgkDeduction: number
  taxDeduction: number
  otherDeduction: number
  netSalary: number
  status: string
  paymentDate?: string | null
}): Promise<Buffer> {
  const earnings: Array<[string, string]> = [
    ["Brüt Maaş", money(args.grossSalary)],
    ["Ek Ödeme / Prim", money(args.bonus)],
    ["Toplam Kazanç", money(args.grossSalary + args.bonus)],
  ]
  const deductions: Array<[string, string]> = [
    ["Avans", money(args.advance)],
    ["SGK Kesintisi", money(args.sgkDeduction)],
    ["Gelir Vergisi", money(args.taxDeduction)],
    ["Diğer", money(args.otherDeduction)],
    [
      "Toplam Kesinti",
      money(args.advance + args.sgkDeduction + args.taxDeduction + args.otherDeduction),
    ],
  ]

  // Yan yana iki tablo: her biri kolon genişliğine göre ölçeklenir (aradaki
  // boşluk düşülür), yoksa ikinci tablo sayfadan taşar.
  const halfWidth = (CONTENT_WIDTH - mm(4)) / 2
  const twoColumnTable = (title: string, rows: Array<[string, string]>, headColor: string) =>
    ({
      width: "*",
      stack: [
        {
          ...(docTable<{ label: string; value: string }>({
            columns: [
              { header: title, width: 60, cell: (r) => r.label },
              { header: "Tutar", width: 40, align: "right", cell: (r) => r.value },
            ],
            rows: rows.map(([label, value]) => ({ label, value })),
            headColor,
            containerWidth: halfWidth,
          }) as any),
        },
      ],
    }) as any

  const content: Content[] = [
    header(args.company, "MAAŞ PUSULASI"),
    employeeBlock(args.employee),
    {
      text: `Dönem: ${MONTHS[args.periodMonth - 1]} ${args.periodYear}`,
      margin: [0, mm(4), 0, 0],
    },
    {
      // İki tablo yan yana: genişlikleri motor paylaştırır (eski sürümde sabit
      // `tableWidth: 87` + `margin` ile elle konumlandırılıyordu).
      columns: [
        twoColumnTable("Kazançlar", earnings, COLORS.headBg),
        twoColumnTable("Kesintiler", deductions, "#b91c1c"),
      ],
      columnGap: mm(4),
      margin: [0, mm(4), 0, 0],
    } as unknown as Content,
    {
      table: {
        widths: ["*", "auto"],
        body: [
          [
            {
              text: "NET ÖDENEN",
              bold: true,
              fontSize: FS.h1,
              fillColor: "#f0fdf4",
              margin: [mm(2), mm(2), mm(2), mm(2)],
            },
            {
              text: softBreak(money(args.netSalary)),
              bold: true,
              fontSize: FS.h1,
              alignment: "right",
              color: "#166534",
              fillColor: "#f0fdf4",
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
    },
    {
      text: [
        `Durum: ${args.status === "PAID" ? "Ödendi" : "Bekliyor"}`,
        args.paymentDate ? `   ·   Ödeme Tarihi: ${date(args.paymentDate)}` : "",
      ].join(""),
      fontSize: FS.small,
      margin: [0, mm(3), 0, 0],
    },
    signatures("Personel İmza", "İşveren İmza"),
  ]

  return renderPdf(
    buildDocDefinition({
      title: `Maaş Pusulası ${args.employee.firstName} ${args.employee.lastName}`,
      footerNote: footerNote(),
      content,
    }),
  )
}

// --------------------------- İZİN FORMU ---------------------------
const LEAVE_TYPES: Record<string, string> = {
  ANNUAL: "Yıllık İzin",
  EXCUSE: "Mazeret İzni",
  SICK: "Hastalık İzni",
  UNPAID: "Ücretsiz İzin",
}

export async function buildLeaveFormPdf(args: {
  company: PdfCompany
  employee: PdfEmployee
  type: string
  startDate: string | Date
  endDate: string | Date
  days: number
  reason?: string | null
  status: string
}): Promise<Buffer> {
  const content: Content[] = [
    header(args.company, "İZİN TALEP FORMU"),
    employeeBlock(args.employee),
    section(
      null,
      fieldTable([
        ["İzin Türü", LEAVE_TYPES[args.type] || args.type],
        ["Başlangıç Tarihi", date(args.startDate)],
        ["Bitiş Tarihi", date(args.endDate)],
        ["Toplam Gün", `${args.days} gün`],
        ["Açıklama", args.reason || "-"],
        [
          "Durum",
          args.status === "APPROVED"
            ? "Onaylandı"
            : args.status === "REJECTED"
              ? "Reddedildi"
              : "Bekliyor",
        ],
      ]),
      mm(5),
    ),
    signatures("Talep Eden (Personel)", "Onaylayan (Yönetici)"),
  ]

  return renderPdf(
    buildDocDefinition({
      title: `İzin Formu ${args.employee.firstName} ${args.employee.lastName}`,
      footerNote: footerNote(),
      content,
    }),
  )
}

// --------------------------- ZİMMET TESLİM/İADE FORMU ---------------------------
export async function buildAssetFormPdf(args: {
  company: PdfCompany
  employee: PdfEmployee
  assetName: string
  category?: string | null
  serialNo?: string | null
  quantity: number
  assignedDate: string | Date
  returnDate?: string | Date | null
  status: string
  notes?: string | null
}): Promise<Buffer> {
  const isReturned = args.status === "RETURNED"
  const statement = isReturned
    ? "Yukarıda belirtilen demirbaş(lar) eksiksiz ve sağlam olarak teslim alınmıştır."
    : "Yukarıda belirtilen demirbaş(lar) tarafıma zimmetlenmiş olup, korunmasından sorumlu olduğumu kabul ederim."

  const content: Content[] = [
    header(args.company, isReturned ? "ZİMMET İADE FORMU" : "ZİMMET TESLİM FORMU"),
    employeeBlock(args.employee),
    section(
      null,
      fieldTable([
        ["Demirbaş / Ekipman", args.assetName],
        ["Kategori", args.category || "-"],
        ["Seri No", args.serialNo || "-"],
        ["Adet", String(args.quantity)],
        ["Zimmet Tarihi", date(args.assignedDate)],
        ["İade Tarihi", isReturned ? date(args.returnDate) : "-"],
        ["Açıklama", args.notes || "-"],
      ]),
      mm(5),
    ),
    { text: softBreak(statement), fontSize: FS.small, margin: [0, mm(6), 0, 0] },
    signatures("Teslim Eden", "Teslim Alan (Personel)"),
  ]

  return renderPdf(
    buildDocDefinition({
      title: `${isReturned ? "Zimmet İade" : "Zimmet Teslim"} ${args.assetName}`,
      footerNote: footerNote(),
      content,
    }),
  )
}
