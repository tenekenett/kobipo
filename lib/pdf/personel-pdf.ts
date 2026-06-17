import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { registerTurkishFont, TURKISH_PDF_FONT } from "@/lib/pdf/unicode-font"

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]

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

const money = (n: number) => `${Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`
const date = (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString("tr-TR") : "-")

async function startDoc(company: PdfCompany, title: string): Promise<jsPDF> {
  const doc = new jsPDF()
  await registerTurkishFont(doc)

  doc.setFontSize(15)
  doc.setFont(TURKISH_PDF_FONT, "bold")
  doc.text(company.name, 14, 18)

  doc.setFontSize(9)
  doc.setFont(TURKISH_PDF_FONT, "normal")
  let y = 24
  if (company.taxNumber) { doc.text(`VKN: ${company.taxNumber}`, 14, y); y += 5 }
  if (company.address) { doc.text(String(company.address).slice(0, 80), 14, y); y += 5 }
  if (company.city) { doc.text(company.city, 14, y); y += 5 }

  doc.setFontSize(16)
  doc.setFont(TURKISH_PDF_FONT, "bold")
  doc.text(title, 196, 18, { align: "right" })

  doc.setDrawColor(200)
  doc.line(14, 40, 196, 40)
  return doc
}

function employeeBlock(doc: jsPDF, emp: PdfEmployee, y: number): number {
  doc.setFontSize(10)
  doc.setFont(TURKISH_PDF_FONT, "bold")
  doc.text("PERSONEL", 14, y)
  doc.setFont(TURKISH_PDF_FONT, "normal")
  doc.text(`${emp.firstName} ${emp.lastName}`, 50, y)
  let yy = y + 6
  if (emp.nationalId) { doc.text(`T.C.: ${emp.nationalId}`, 50, yy); yy += 6 }
  const role = [emp.position, emp.department].filter(Boolean).join(" / ")
  if (role) { doc.text(role, 50, yy); yy += 6 }
  return yy
}

function footer(doc: jsPDF) {
  doc.setFontSize(8)
  doc.setTextColor(128)
  doc.text(`Oluşturma: ${new Date().toLocaleString("tr-TR")}`, 14, 285)
  doc.setTextColor(0)
}

function toBytes(doc: jsPDF) {
  return Buffer.from(doc.output("arraybuffer"))
}

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
}) {
  const doc = await startDoc(args.company, "MAAŞ PUSULASI")
  let y = employeeBlock(doc, args.employee, 50)
  doc.setFont(TURKISH_PDF_FONT, "normal")
  doc.setFontSize(10)
  doc.text(`Dönem: ${MONTHS[args.periodMonth - 1]} ${args.periodYear}`, 14, y + 2)
  if (args.employee.iban) doc.text(`IBAN: ${args.employee.iban}`, 90, y + 2)
  y += 8

  autoTable(doc, {
    startY: y,
    head: [["Kazançlar", "Tutar"]],
    body: [
      ["Brüt Maaş", money(args.grossSalary)],
      ["Ek Ödeme / Prim", money(args.bonus)],
      [{ content: "Toplam Kazanç", styles: { fontStyle: "bold" } }, { content: money(args.grossSalary + args.bonus), styles: { fontStyle: "bold" } }],
    ],
    styles: { font: TURKISH_PDF_FONT, fontSize: 10, cellPadding: 3 },
    headStyles: { font: TURKISH_PDF_FONT, fillColor: [59, 130, 246], textColor: 255 },
    columnStyles: { 1: { halign: "right" } },
    margin: { left: 14, right: 105 },
    tableWidth: 87,
  })

  autoTable(doc, {
    startY: y,
    head: [["Kesintiler", "Tutar"]],
    body: [
      ["Avans", money(args.advance)],
      ["SGK Kesintisi", money(args.sgkDeduction)],
      ["Gelir Vergisi", money(args.taxDeduction)],
      ["Diğer", money(args.otherDeduction)],
      [{ content: "Toplam Kesinti", styles: { fontStyle: "bold" } }, { content: money(args.advance + args.sgkDeduction + args.taxDeduction + args.otherDeduction), styles: { fontStyle: "bold" } }],
    ],
    styles: { font: TURKISH_PDF_FONT, fontSize: 10, cellPadding: 3 },
    headStyles: { font: TURKISH_PDF_FONT, fillColor: [185, 28, 28], textColor: 255 },
    columnStyles: { 1: { halign: "right" } },
    margin: { left: 109, right: 14 },
    tableWidth: 87,
  })

  const finalY = (doc as any).lastAutoTable.finalY + 12
  doc.setFillColor(240, 253, 244)
  doc.rect(14, finalY - 6, 182, 14, "F")
  doc.setFont(TURKISH_PDF_FONT, "bold")
  doc.setFontSize(13)
  doc.text("NET ÖDENEN", 18, finalY + 3)
  doc.setTextColor(22, 101, 52)
  doc.text(money(args.netSalary), 192, finalY + 3, { align: "right" })
  doc.setTextColor(0)

  doc.setFont(TURKISH_PDF_FONT, "normal")
  doc.setFontSize(9)
  doc.text(`Durum: ${args.status === "PAID" ? "Ödendi" : "Bekliyor"}`, 14, finalY + 16)
  if (args.paymentDate) doc.text(`Ödeme Tarihi: ${date(args.paymentDate)}`, 70, finalY + 16)

  doc.text("Personel İmza: ____________________", 14, finalY + 40)
  doc.text("İşveren İmza: ____________________", 120, finalY + 40)

  footer(doc)
  return toBytes(doc)
}

// --------------------------- İZİN FORMU ---------------------------
const LEAVE_TYPES: Record<string, string> = { ANNUAL: "Yıllık İzin", EXCUSE: "Mazeret İzni", SICK: "Hastalık İzni", UNPAID: "Ücretsiz İzin" }

export async function buildLeaveFormPdf(args: {
  company: PdfCompany
  employee: PdfEmployee
  type: string
  startDate: string | Date
  endDate: string | Date
  days: number
  reason?: string | null
  status: string
}) {
  const doc = await startDoc(args.company, "İZİN TALEP FORMU")
  let y = employeeBlock(doc, args.employee, 50) + 6

  autoTable(doc, {
    startY: y,
    body: [
      ["İzin Türü", LEAVE_TYPES[args.type] || args.type],
      ["Başlangıç Tarihi", date(args.startDate)],
      ["Bitiş Tarihi", date(args.endDate)],
      ["Toplam Gün", `${args.days} gün`],
      ["Açıklama", args.reason || "-"],
      ["Durum", args.status === "APPROVED" ? "Onaylandı" : args.status === "REJECTED" ? "Reddedildi" : "Bekliyor"],
    ],
    styles: { font: TURKISH_PDF_FONT, fontSize: 11, cellPadding: 4 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 50, fillColor: [243, 244, 246] }, 1: { cellWidth: "auto" } },
    margin: { left: 14, right: 14 },
  })

  const finalY = (doc as any).lastAutoTable.finalY + 30
  doc.setFontSize(10)
  doc.text("Talep Eden (Personel)", 30, finalY, { align: "center" })
  doc.text("Onaylayan (Yönetici)", 165, finalY, { align: "center" })
  doc.line(14, finalY - 4, 76, finalY - 4)
  doc.line(134, finalY - 4, 196, finalY - 4)

  footer(doc)
  return toBytes(doc)
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
}) {
  const isReturned = args.status === "RETURNED"
  const doc = await startDoc(args.company, isReturned ? "ZİMMET İADE FORMU" : "ZİMMET TESLİM FORMU")
  let y = employeeBlock(doc, args.employee, 50) + 6

  autoTable(doc, {
    startY: y,
    body: [
      ["Demirbaş / Ekipman", args.assetName],
      ["Kategori", args.category || "-"],
      ["Seri No", args.serialNo || "-"],
      ["Adet", String(args.quantity)],
      ["Zimmet Tarihi", date(args.assignedDate)],
      ["İade Tarihi", isReturned ? date(args.returnDate) : "-"],
      ["Açıklama", args.notes || "-"],
    ],
    styles: { font: TURKISH_PDF_FONT, fontSize: 11, cellPadding: 4 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 50, fillColor: [243, 244, 246] }, 1: { cellWidth: "auto" } },
    margin: { left: 14, right: 14 },
  })

  const finalY = (doc as any).lastAutoTable.finalY + 16
  doc.setFontSize(9)
  doc.setFont(TURKISH_PDF_FONT, "normal")
  const statement = isReturned
    ? "Yukarıda belirtilen demirbaş(lar) eksiksiz ve sağlam olarak teslim alınmıştır."
    : "Yukarıda belirtilen demirbaş(lar) tarafıma zimmetlenmiş olup, korunmasından sorumlu olduğumu kabul ederim."
  doc.text(doc.splitTextToSize(statement, 182), 14, finalY)

  const signY = finalY + 30
  doc.setFontSize(10)
  doc.text("Teslim Eden", 30, signY, { align: "center" })
  doc.text("Teslim Alan (Personel)", 165, signY, { align: "center" })
  doc.line(14, signY - 4, 76, signY - 4)
  doc.line(134, signY - 4, 196, signY - 4)

  footer(doc)
  return toBytes(doc)
}
