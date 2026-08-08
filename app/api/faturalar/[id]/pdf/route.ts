import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { resolveSlugId } from "@/lib/slug-resolve"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { registerTurkishFont, TURKISH_PDF_FONT } from "@/lib/pdf/unicode-font"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    const { searchParams } = new URL(request.url)
    const template = searchParams.get("template") || "standart"
    // Fatura id'si dashboard'dan slug (fatura no) gelebilir → cuid'e çevir. Firma scope'u
    // için company/companyId param'ı da (slug olabilir) çözülür; yoksa global slug araması
    // yapılır ve erişim aşağıdaki ensureCompanyAccess ile korunur. [[slug-resolve.ts]]
    const scopeCompanyId = await resolveCompanyId(
      searchParams.get("companyId") || searchParams.get("company"),
    )
    const invoiceId = await resolveSlugId("invoice", resolvedParams.id, scopeCompanyId)

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        customer: true,
        supplier: true,
        items: {
          include: {
            product: true,
          },
          orderBy: {
            order: "asc",
          },
        },
        company: {
          select: {
            id: true,
            name: true,
            taxNumber: true,
            taxOffice: true,
            address: true,
            city: true,
            phone: true,
            email: true,
          },
        },
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    await ensureCompanyAccess(invoice.companyId)

    // Prepare invoice data for PDF
    const invoiceData = {
      invoiceNo: invoice.invoiceNo,
      date: invoice.date.toISOString(),
      dueDate: invoice.dueDate?.toISOString(),
      type: invoice.type as "SALES" | "PURCHASE",
      invoiceType: invoice.invoiceType as "E_INVOICE" | "E_ARCHIVE" | "MANUAL",
      customer: invoice.customer ? {
        name: invoice.customer.name,
        taxNumber: invoice.customer.taxNumber || undefined,
        taxOffice: invoice.customer.taxOffice || undefined,
        address: invoice.customer.address || undefined,
        city: invoice.customer.city || undefined,
        district: invoice.customer.district || undefined,
        phone: invoice.customer.phone || undefined,
        email: invoice.customer.email || undefined,
      } : undefined,
      supplier: invoice.supplier ? {
        name: invoice.supplier.name,
        taxNumber: invoice.supplier.taxNumber || undefined,
        taxOffice: invoice.supplier.taxOffice || undefined,
        address: invoice.supplier.address || undefined,
        city: invoice.supplier.city || undefined,
        district: invoice.supplier.district || undefined,
        phone: invoice.supplier.phone || undefined,
        email: invoice.supplier.email || undefined,
      } : undefined,
      company: {
        name: invoice.company.name,
        taxNumber: invoice.company.taxNumber || undefined,
        taxOffice: invoice.company.taxOffice || undefined,
        address: invoice.company.address || undefined,
        city: invoice.company.city || undefined,
        phone: invoice.company.phone || undefined,
        email: invoice.company.email || undefined,
      },
      items: invoice.items.map(item => ({
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        discountRate: Number(item.discountRate || 0),
        discountAmount: Number(item.discountAmount || 0),
        vatRate: Number(item.vatRate),
        total: Number(item.totalAmount),
      })),
      netAmount: Number(invoice.netAmount),
      vatAmount: Number(invoice.vatAmount),
      totalAmount: Number(invoice.totalAmount),
      globalDiscountAmount: Number(invoice.globalDiscountAmount || 0),
      notes: invoice.notes || undefined,
    }

    // Generate PDF
    const doc = new jsPDF()
    // Türkçe karakterler için Unicode font yükle (helvetica WinAnsi — Türkçe yok)
    await registerTurkishFont(doc)

    // Company Info (Top Left)
    doc.setFontSize(16)
    doc.setFont(TURKISH_PDF_FONT, "bold")
    // Uzun unvan sağdaki fatura başlığına (x=140) binmesin diye ~120mm'e sarılır.
    const companyNameLines: string[] = doc.splitTextToSize(invoiceData.company.name || "", 120)
    doc.text(companyNameLines, 14, 20)

    doc.setFontSize(9)
    doc.setFont(TURKISH_PDF_FONT, "normal")
    // Detaylar unvan kaç satır sürdüyse altından akar (sabit y yerine cursor).
    let cursorY = 20 + (companyNameLines.length - 1) * 6.5 + 6
    if (invoiceData.company.taxNumber) {
      doc.text(`VKN: ${invoiceData.company.taxNumber}`, 14, cursorY)
      cursorY += 5
    }
    if (invoiceData.company.address) {
      doc.text(invoiceData.company.address, 14, cursorY)
      cursorY += 5
    }
    if (invoiceData.company.city) {
      doc.text(invoiceData.company.city, 14, cursorY)
      cursorY += 5
    }
    if (invoiceData.company.phone) {
      doc.text(`Tel: ${invoiceData.company.phone}`, 14, cursorY)
      cursorY += 5
    }
    
    // Invoice Info (Top Right)
    doc.setFontSize(20)
    doc.setFont(TURKISH_PDF_FONT, "bold")
    const invoiceTitle =
      invoiceData.invoiceType === "E_INVOICE"
        ? "E-FATURA"
        : invoiceData.invoiceType === "E_ARCHIVE"
          ? "E-ARSIV FATURA"
          : "MANUEL FATURA"
    doc.text(invoiceTitle, 140, 20)
    if (template !== "standart") {
      doc.setFontSize(9)
      doc.text(`Şablon: ${template}`, 140, 24)
    }
    
    doc.setFontSize(10)
    doc.setFont(TURKISH_PDF_FONT, "normal")
    doc.text(`Fatura No: ${invoiceData.invoiceNo}`, 140, 28)
    doc.text(`Tarih: ${new Date(invoiceData.date).toLocaleDateString("tr-TR")}`, 140, 34)
    if (invoiceData.dueDate) {
      doc.text(`Vade: ${new Date(invoiceData.dueDate).toLocaleDateString("tr-TR")}`, 140, 40)
    }
    doc.text(`Tip: ${invoiceData.type === "SALES" ? "Satış" : "Alış"}`, 140, 46)
    
    // Customer/Supplier Info
    const recipient = invoiceData.type === "SALES" ? invoiceData.customer : invoiceData.supplier
    const recipientLabel = invoiceData.type === "SALES" ? "MÜŞTERİ BİLGİLERİ" : "TEDARİKÇİ BİLGİLERİ"
    
    doc.setFillColor(240, 240, 240)
    doc.rect(14, 55, 182, 25, "F")
    
    doc.setFontSize(11)
    doc.setFont(TURKISH_PDF_FONT, "bold")
    doc.text(recipientLabel, 18, 62)
    
    doc.setFontSize(10)
    doc.setFont(TURKISH_PDF_FONT, "normal")
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
      const recipientLocation = [recipient.district, recipient.city].filter(Boolean).join(" / ")
      if (recipientLocation) {
        doc.text(recipientLocation, 100, 74)
      }
    }
    
    // Items Table
    const tableData = invoiceData.items.map((item, index) => [
      (index + 1).toString(),
      item.description,
      item.quantity.toLocaleString("tr-TR", { minimumFractionDigits: 2 }),
      `₺${item.unitPrice.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`,
      `-₺${item.discountAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`,
      `%${item.vatRate}`,
      `₺${item.total.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`,
    ])
    
    autoTable(doc, {
      startY: 90,
      head: [["#", "Açıklama", "Miktar", "Birim Fiyat", "Iskonto", "KDV", "Tutar"]],
      body: tableData,
      styles: {
        font: TURKISH_PDF_FONT,
        fontSize: 9,
        cellPadding: 3,
      },
      headStyles: {
        font: TURKISH_PDF_FONT,
        fillColor: template === "kurumsal" ? [22, 101, 52] : [59, 130, 246],
        textColor: 255,
        fontStyle: "bold",
      },
      columnStyles: {
        0: { cellWidth: 10, halign: "center" },
        1: { cellWidth: "auto" },
        2: { cellWidth: 25, halign: "right" },
        3: { cellWidth: 30, halign: "right" },
        4: { cellWidth: 24, halign: "right" },
        5: { cellWidth: 18, halign: "center" },
        6: { cellWidth: 28, halign: "right" },
      },
      alternateRowStyles: {
        fillColor: [249, 250, 251],
      },
    })
    
    // Get the final Y position after the table
    const finalY = (doc as any).lastAutoTable.finalY + 10
    
    // Totals — Ara Toplam (brüt), Satır İskontoları, Fatura İskontosu, KDV, Genel Toplam
    const totalsX = 130
    doc.setFontSize(10)

    const grossTotal = invoice.items.reduce(
      (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice),
      0,
    )
    const lineDiscountTotal = invoice.items.reduce(
      (sum, item) => sum + Number(item.discountAmount || 0),
      0,
    )
    const globalDiscount = invoiceData.globalDiscountAmount

    let y = finalY
    doc.text("Ara Toplam:", totalsX, y)
    doc.text(`₺${grossTotal.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`, 180, y, { align: "right" })

    if (lineDiscountTotal > 0) {
      y += 6
      doc.text("Satır İskontoları:", totalsX, y)
      doc.text(`-₺${lineDiscountTotal.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`, 180, y, { align: "right" })
    }

    if (globalDiscount > 0) {
      y += 6
      doc.text("Fatura İskontosu:", totalsX, y)
      doc.text(`-₺${globalDiscount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`, 180, y, { align: "right" })
    }

    y += 6
    doc.text("Matrah:", totalsX, y)
    doc.text(`₺${invoiceData.netAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`, 180, y, { align: "right" })

    y += 6
    doc.text("KDV Toplam:", totalsX, y)
    doc.text(`₺${invoiceData.vatAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`, 180, y, { align: "right" })

    y += 8
    doc.setFont(TURKISH_PDF_FONT, "bold")
    doc.setFontSize(12)
    doc.text("GENEL TOPLAM:", totalsX, y)
    doc.setTextColor(34, 197, 94)
    doc.text(`₺${invoiceData.totalAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`, 180, y, { align: "right" })
    doc.setTextColor(0, 0, 0)
    
    // Notes
    if (invoiceData.notes) {
      doc.setFont(TURKISH_PDF_FONT, "normal")
      doc.setFontSize(9)
      doc.text("Notlar:", 14, y + 10)
      doc.text(invoiceData.notes, 14, y + 16)
    }
    
    // Footer
    doc.setFontSize(8)
    doc.setTextColor(128, 128, 128)
    doc.text(`Bu belge ${new Date().toLocaleString("tr-TR")} tarihinde oluşturulmuştur.`, 14, 280)
    doc.text("Ön Muhasebe SaaS Platformu", 180, 280, { align: "right" })
    
    // Convert to buffer
    const pdfBuffer = Buffer.from(doc.output("arraybuffer"))
    
    // Return PDF as response
    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Fatura_${invoiceData.invoiceNo}.pdf"`,
      },
    })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error generating PDF:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

