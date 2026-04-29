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
  notes?: string
}

export async function generateInvoicePDF(data: InvoiceData): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ])
  const doc = new jsPDF()
  
  // Company Info (Top Left)
  doc.setFontSize(18)
  doc.setFont("helvetica", "bold")
  doc.text(data.company.name, 14, 20)
  
  doc.setFontSize(9)
  doc.setFont("helvetica", "normal")
  if (data.company.taxNumber) {
    doc.text(`VKN: ${data.company.taxNumber}`, 14, 26)
  }
  if (data.company.address) {
    doc.text(data.company.address, 14, 31)
  }
  if (data.company.city) {
    doc.text(data.company.city, 14, 36)
  }
  if (data.company.phone) {
    doc.text(`Tel: ${data.company.phone}`, 14, 41)
  }
  
  // Invoice Info (Top Right)
  doc.setFontSize(20)
  doc.setFont("helvetica", "bold")
  const invoiceTitle =
    data.invoiceType === "E_INVOICE"
      ? "E-FATURA"
      : data.invoiceType === "E_ARCHIVE"
        ? "E-ARSIV FATURA"
        : "MANUEL FATURA"
  doc.text(invoiceTitle, 140, 20)
  
  doc.setFontSize(10)
  doc.setFont("helvetica", "normal")
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
  doc.setFont("helvetica", "bold")
  doc.text(recipientLabel, 18, 62)
  
  doc.setFontSize(10)
  doc.setFont("helvetica", "normal")
  if (recipient) {
    doc.text(recipient.name || "", 18, 68)
    if (recipient.taxNumber) {
      doc.text(`VKN: ${recipient.taxNumber}`, 18, 74)
    }
    if (recipient.address) {
      doc.text(recipient.address, 100, 68)
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
      fontSize: 9,
      cellPadding: 3,
    },
    headStyles: {
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
  
  // Totals
  const totalsX = 130
  doc.setFontSize(10)
  
  doc.text("Ara Toplam:", totalsX, finalY)
  doc.text(`₺${data.netAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`, 180, finalY, { align: "right" })
  
  doc.text("KDV Toplam:", totalsX, finalY + 6)
  doc.text(`₺${data.vatAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`, 180, finalY + 6, { align: "right" })
  
  doc.setFont("helvetica", "bold")
  doc.setFontSize(12)
  doc.text("GENEL TOPLAM:", totalsX, finalY + 14)
  doc.setTextColor(34, 197, 94)
  doc.text(`₺${data.totalAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`, 180, finalY + 14, { align: "right" })
  doc.setTextColor(0, 0, 0)
  
  // Notes
  if (data.notes) {
    doc.setFont("helvetica", "normal")
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

