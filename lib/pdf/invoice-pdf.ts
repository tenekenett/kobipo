"use client"

interface InvoiceItem {
  description: string
  quantity: number
  unitPrice: number
  vatRate: number
  total: number
}

interface InvoiceData {
  invoiceNo: string
  date: string
  dueDate?: string
  type: "SALES" | "PURCHASE"
  invoiceType: "E_INVOICE" | "E_ARCHIVE" | "MANUAL"
  customer?: {
    name: string
    taxNumber?: string
    taxOffice?: string
    address?: string
    city?: string
    phone?: string
    email?: string
  }
  supplier?: {
    name: string
    taxNumber?: string
    taxOffice?: string
    address?: string
    city?: string
    phone?: string
    email?: string
  }
  company: {
    name: string
    taxNumber?: string
    taxOffice?: string
    address?: string
    city?: string
    phone?: string
    email?: string
  }
  items: InvoiceItem[]
  netAmount: number
  vatAmount: number
  totalAmount: number
  // KDV dışı "Diğer Vergiler" (ör. Özel İletişim Vergisi/ÖİV). >0 ise KDV ile Genel
  // Toplam arasına ayrı satır olarak yazılır; verilmezse çizilmez (geriye uyumlu).
  otherTaxAmount?: number
  otherTaxLabel?: string
  notes?: string
}

export async function generateInvoicePDF(data: InvoiceData): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }, { registerTurkishFontClient, TURKISH_PDF_FONT }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    import("./unicode-font"),
  ])
  const doc = new jsPDF()
  // Türkçe karakter desteği için Unicode font yükle (public/fonts/*)
  await registerTurkishFontClient(doc)
  const FONT = TURKISH_PDF_FONT

  // Company Info (Top Left)
  doc.setFontSize(16)
  doc.setFont(FONT, "bold")
  // Uzun unvan sağdaki başlığa (x=140) binmesin diye ~120mm'e sarılır.
  const companyNameLines: string[] = doc.splitTextToSize(data.company.name || "", 120)
  doc.text(companyNameLines, 14, 20)

  doc.setFontSize(9)
  doc.setFont(FONT, "normal")
  // Detaylar unvan kaç satır sürdüyse altından akar (sabit y yerine cursor).
  let cursorY = 20 + (companyNameLines.length - 1) * 6.5 + 6
  if (data.company.taxNumber) {
    doc.text(`VKN: ${data.company.taxNumber}`, 14, cursorY)
    cursorY += 5
  }
  if (data.company.address) {
    doc.text(data.company.address, 14, cursorY)
    cursorY += 5
  }
  if (data.company.city) {
    doc.text(data.company.city, 14, cursorY)
    cursorY += 5
  }
  if (data.company.phone) {
    doc.text(`Tel: ${data.company.phone}`, 14, cursorY)
    cursorY += 5
  }
  
  // Invoice Info (Top Right)
  doc.setFontSize(20)
  doc.setFont(FONT, "bold")
  const invoiceTitle =
    data.invoiceType === "E_INVOICE"
      ? "E-FATURA"
      : data.invoiceType === "E_ARCHIVE"
        ? "E-ARSIV FATURA"
        : "MANUEL FATURA"
  doc.text(invoiceTitle, 140, 20)
  
  doc.setFontSize(10)
  doc.setFont(FONT, "normal")
  doc.text(`Fatura No: ${data.invoiceNo}`, 140, 28)
  doc.text(`Tarih: ${new Date(data.date).toLocaleDateString("tr-TR")}`, 140, 34)
  if (data.dueDate) {
    doc.text(`Vade: ${new Date(data.dueDate).toLocaleDateString("tr-TR")}`, 140, 40)
  }
  doc.text(`Tip: ${data.type === "SALES" ? "Satış" : "Alış"}`, 140, 46)
  
  // Customer/Supplier Info
  const recipient = data.type === "SALES" ? data.customer : data.supplier
  const recipientLabel = data.type === "SALES" ? "MÜŞTERİ BİLGİLERİ" : "TEDARİKÇİ BİLGİLERİ"
  
  doc.setFillColor(240, 240, 240)
  doc.rect(14, 55, 182, 25, "F")
  
  doc.setFontSize(11)
  doc.setFont(FONT, "bold")
  doc.text(recipientLabel, 18, 62)
  
  doc.setFontSize(10)
  doc.setFont(FONT, "normal")
  if (recipient) {
    // Müşteri adını sol sütuna sığdır (sağdaki adres sütununa binmesin); VKN adın altından akar.
    const recipientNameLines = (doc.splitTextToSize(recipient.name || "", 78) as string[]).slice(0, 2)
    doc.text(recipientNameLines, 18, 68)
    const leftY = 68 + recipientNameLines.length * 5
    if (recipient.taxNumber) {
      doc.text(`VKN: ${recipient.taxNumber}`, 18, leftY)
    }
    if (recipient.address) {
      const addrLines = (doc.splitTextToSize(recipient.address, 93) as string[]).slice(0, 1)
      doc.text(addrLines, 100, 68)
    }
    if (recipient.city) {
      doc.text(recipient.city, 100, 74)
    }
  }
  
  // Items Table
  const tableData = data.items.map((item, index) => [
    (index + 1).toString(),
    item.description,
    item.quantity.toLocaleString("tr-TR", { minimumFractionDigits: 2 }),
    `₺${item.unitPrice.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`,
    `%${item.vatRate}`,
    `₺${item.total.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`,
  ])
  
  autoTable(doc, {
    startY: 90,
    head: [["#", "Açıklama", "Miktar", "Birim Fiyat", "KDV", "Tutar"]],
    body: tableData,
    styles: {
      font: FONT,
      fontSize: 9,
      cellPadding: 3,
    },
    headStyles: {
      font: FONT,
      fillColor: [59, 130, 246],
      textColor: 255,
      fontStyle: "bold",
    },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: "auto" },
      2: { cellWidth: 25, halign: "right" },
      3: { cellWidth: 30, halign: "right" },
      4: { cellWidth: 20, halign: "center" },
      5: { cellWidth: 35, halign: "right" },
    },
    alternateRowStyles: {
      fillColor: [249, 250, 251],
    },
  })
  
  // Get the final Y position after the table
  const finalY = (doc as any).lastAutoTable.finalY + 10
  
  // Totals — hem etiket hem değer sağa hizalı. Etiket, değerin ölçülen
  // genişliğinden 6mm önce biter; böylece büyük (7+ haneli) tutarlarda etiket ile
  // değer üst üste binmez ("GENEL TOPLAM:" ile tutarın iç içe geçmesi sorunu).
  const totalsValueX = 196
  const drawTotalRow = (label: string, value: string, rowY: number) => {
    doc.text(value, totalsValueX, rowY, { align: "right" })
    const labelRightX = totalsValueX - doc.getTextWidth(value) - 6
    doc.text(label, labelRightX, rowY, { align: "right" })
  }

  doc.setFont(FONT, "normal")
  doc.setFontSize(10)
  drawTotalRow("Ara Toplam:", `₺${data.netAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`, finalY)
  drawTotalRow("KDV Toplam:", `₺${data.vatAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`, finalY + 6)
  // KDV dışı diğer vergiler (ör. ÖİV) varsa ayrı satır — aksi halde Genel Toplam,
  // Ara Toplam + KDV ile tutmaz görünürdü.
  let rowY = finalY + 6
  if ((data.otherTaxAmount || 0) > 0) {
    rowY += 6
    drawTotalRow(
      `${data.otherTaxLabel || "Diğer Vergiler"}:`,
      `₺${(data.otherTaxAmount as number).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`,
      rowY,
    )
  }

  doc.setFont(FONT, "bold")
  doc.setFontSize(12)
  const grandTotal = `₺${data.totalAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`
  const grandLabelRightX = totalsValueX - doc.getTextWidth(grandTotal) - 6
  doc.text("GENEL TOPLAM:", grandLabelRightX, rowY + 8, { align: "right" })
  doc.setTextColor(34, 197, 94)
  doc.text(grandTotal, totalsValueX, rowY + 8, { align: "right" })
  doc.setTextColor(0, 0, 0)
  
  // Notes
  if (data.notes) {
    doc.setFont(FONT, "normal")
    doc.setFontSize(9)
    doc.text("Notlar:", 14, finalY + 30)
    doc.text(data.notes, 14, finalY + 36)
  }
  
  // Footer
  doc.setFontSize(8)
  doc.setTextColor(128, 128, 128)
  doc.text(`Bu belge ${new Date().toLocaleString("tr-TR")} tarihinde oluşturulmuştur.`, 14, 280)
  doc.text("On Muhasebe SaaS Platformu", 180, 280, { align: "right" })
  
  // Save PDF
  doc.save(`Fatura_${data.invoiceNo}.pdf`)
}

