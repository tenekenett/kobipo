"use client"

export interface MakbuzData {
  /** "Tahsilat" | "Ödeme" | "Gelir" | "Gider" */
  kind: string
  /** Belge/makbuz no (referans yoksa işlem id kısaltması). */
  makbuzNo: string
  date: string
  amount: number
  currency: string
  description?: string | null
  reference?: string | null
  paymentMethod: string
  account: { name: string; bankName?: string | null }
  company: {
    name?: string | null
    taxNumber?: string | null
    address?: string | null
    city?: string | null
    phone?: string | null
  }
  cari?: { label: string; name: string; taxNumber?: string | null } | null
  invoices: Array<{ invoiceNo: string; amount: number }>
}

function fmt(amount: number, currency = "TRY") {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency }).format(amount)
}

/**
 * Tahsilat/Ödeme makbuzu (PDF) üretir ve indirir. İstemci tarafı; Türkçe için
 * DejaVu Unicode fontu public/fonts'tan yüklenir. Fatura PDF'i ile aynı desen.
 */
export async function generateMakbuzPDF(data: MakbuzData): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }, { registerTurkishFontClient, TURKISH_PDF_FONT }] =
    await Promise.all([import("jspdf"), import("jspdf-autotable"), import("./unicode-font")])

  const doc = new jsPDF()
  await registerTurkishFontClient(doc)
  const FONT = TURKISH_PDF_FONT
  const isIncome = data.kind === "Tahsilat" || data.kind === "Gelir"

  // Başlık genişliğini önce ölç ki firma unvanı buna göre sarılsın ve üst üste
  // binmesin (uzun unvanlarda "...TİCARET" ile "TAHSİLAT MAKBUZU" çakışıyordu).
  const titleStr = `${data.kind.toLocaleUpperCase("tr-TR")} MAKBUZU`
  doc.setFontSize(18)
  doc.setFont(FONT, "bold")
  const titleLeftX = 196 - doc.getTextWidth(titleStr)

  // --- Üst: firma bilgileri (sol) ---
  doc.setFontSize(16)
  doc.setFont(FONT, "bold")
  // Unvanı başlığın sol kenarından 8mm önce bitecek şekilde sar (min 70mm).
  const companyMaxW = Math.max(70, titleLeftX - 14 - 8)
  const companyNameLines: string[] = doc.splitTextToSize(data.company.name || "", companyMaxW)
  doc.text(companyNameLines, 14, 20)
  doc.setFontSize(9)
  doc.setFont(FONT, "normal")
  let y = 20 + (companyNameLines.length - 1) * 6.5 + 6
  if (data.company.taxNumber) { doc.text(`VKN: ${data.company.taxNumber}`, 14, y); y += 5 }
  if (data.company.address) { doc.text(data.company.address, 14, y); y += 5 }
  if (data.company.city) { doc.text(data.company.city, 14, y); y += 5 }
  if (data.company.phone) { doc.text(`Tel: ${data.company.phone}`, 14, y); y += 5 }

  // --- Üst: makbuz başlığı (sağ) ---
  doc.setFontSize(18)
  doc.setFont(FONT, "bold")
  doc.text(titleStr, 196, 20, { align: "right" })
  doc.setFontSize(10)
  doc.setFont(FONT, "normal")
  doc.text(`Makbuz No: ${data.makbuzNo}`, 196, 28, { align: "right" })
  doc.text(`Tarih: ${new Date(data.date).toLocaleDateString("tr-TR")}`, 196, 34, { align: "right" })

  // --- Cari kutusu ---
  let top = Math.max(y, 40) + 4
  doc.setFillColor(243, 244, 246)
  doc.rect(14, top, 182, 22, "F")
  doc.setFontSize(10)
  doc.setFont(FONT, "bold")
  doc.text(data.cari?.label || "CARİ", 18, top + 7)
  doc.setFont(FONT, "normal")
  // Cari adını sağdaki VKN sütununa (x=120) binmemesi için ~98mm'e sar, tek satır.
  const cariNameLines = (doc.splitTextToSize(data.cari?.name || "-", 98) as string[]).slice(0, 1)
  doc.text(cariNameLines, 18, top + 14)
  if (data.cari?.taxNumber) doc.text(`VKN/TCKN: ${data.cari.taxNumber}`, 120, top + 14)

  // --- Tutar vurgusu ---
  top += 32
  doc.setFontSize(11)
  doc.setFont(FONT, "bold")
  doc.text(isIncome ? "Tahsil Edilen Tutar" : "Ödenen Tutar", 18, top)
  doc.setFontSize(18)
  doc.text(fmt(data.amount, data.currency), 196, top + 1, { align: "right" })

  // --- Bilgi tablosu ---
  top += 8
  const rows: Array<[string, string]> = [
    ["Ödeme Yöntemi", data.paymentMethod],
    ["Hesap", data.account.bankName ? `${data.account.name} · ${data.account.bankName}` : data.account.name],
  ]
  if (data.reference) rows.push(["Referans", data.reference])
  if (data.description?.trim()) rows.push(["Açıklama", data.description.trim()])

  autoTable(doc, {
    startY: top,
    body: rows,
    theme: "grid",
    styles: { font: FONT, fontSize: 10, cellPadding: 2.5 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 50 } },
    margin: { left: 14, right: 14 },
  })

  // --- Eşleşen faturalar ---
  let afterY = (doc as any).lastAutoTable?.finalY ?? top + 10
  if (data.invoices.length > 0) {
    autoTable(doc, {
      startY: afterY + 6,
      head: [["Eşleştiği Fatura", "Tutar"]],
      body: data.invoices.map((i) => [i.invoiceNo, fmt(i.amount, data.currency)]),
      theme: "striped",
      headStyles: { font: FONT, fontStyle: "bold", fillColor: [37, 99, 235] },
      styles: { font: FONT, fontSize: 9, cellPadding: 2 },
      columnStyles: { 1: { halign: "right" } },
      margin: { left: 14, right: 14 },
    })
    afterY = (doc as any).lastAutoTable?.finalY ?? afterY
  }

  // --- İmza alanları ---
  const signY = Math.min(afterY + 30, 270)
  doc.setFontSize(10)
  doc.setFont(FONT, "normal")
  doc.text("Teslim Eden", 45, signY, { align: "center" })
  doc.text("Teslim Alan", 150, signY, { align: "center" })
  doc.setDrawColor(160, 160, 160)
  doc.line(20, signY - 6, 75, signY - 6)
  doc.line(120, signY - 6, 180, signY - 6)

  doc.save(`${data.kind}-Makbuzu-${data.makbuzNo}.pdf`)
}
