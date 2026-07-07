import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { resolveSlugId } from "@/lib/slug-resolve"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { registerTurkishFont, TURKISH_PDF_FONT } from "@/lib/pdf/unicode-font"

export const dynamic = "force-dynamic"

const currencySymbol = (code: string) => {
  switch (code) {
    case "TRY":
      return "₺"
    case "USD":
      return "$"
    case "EUR":
      return "€"
    default:
      return code + " "
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: rawId } = await params
    const url = new URL(request.url)
    // Teklif id'si dashboard'dan slug (teklif no) gelebilir → cuid'e çevir. [[slug-resolve.ts]]
    const scopeCompanyId = await resolveCompanyId(
      url.searchParams.get("companyId") || url.searchParams.get("company"),
    )
    const id = await resolveSlugId("quote", rawId, scopeCompanyId)

    const quote = await prisma.quote.findUnique({
      where: { id },
      include: {
        customer: true,
        supplier: true,
        items: {
          include: { product: true },
          orderBy: { order: "asc" },
        },
        company: {
          select: {
            id: true,
            name: true,
            taxNumber: true,
            taxOffice: true,
            address: true,
            city: true,
            country: true,
            phone: true,
            email: true,
            website: true,
          },
        },
      },
    })

    if (!quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 })
    }

    await ensureCompanyAccess(quote.companyId)

    const bankAccounts = await prisma.financialAccount.findMany({
      where: {
        companyId: quote.companyId,
        type: "BANK",
        isActive: true,
      },
      orderBy: { name: "asc" },
      select: {
        name: true,
        bankName: true,
        accountNumber: true,
        iban: true,
        currency: true,
      },
    })

    const symbol = currencySymbol(quote.currency || "TRY")
    const fmtNumber = (n: number) =>
      n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const fmtMoney = (n: number) => `${symbol}${fmtNumber(n)}`

    const doc = new jsPDF()
    await registerTurkishFont(doc)

    // Firma Bilgileri (Sol Üst)
    doc.setFontSize(16)
    doc.setFont(TURKISH_PDF_FONT, "bold")
    // Uzun unvan sağdaki "TEKLİF" başlığına binmesin diye ~120mm genişliğe sarılır.
    const companyNameLines: string[] = doc.splitTextToSize(quote.company.name || "", 120)
    doc.text(companyNameLines, 14, 20)

    doc.setFontSize(9)
    doc.setFont(TURKISH_PDF_FONT, "normal")
    // Detaylar, unvan kaç satır sürdüyse onun hemen altından başlar.
    let cursorY = 20 + (companyNameLines.length - 1) * 6.5 + 6
    if (quote.company.taxNumber) {
      const office = quote.company.taxOffice ? ` / ${quote.company.taxOffice}` : ""
      doc.text(`VKN: ${quote.company.taxNumber}${office}`, 14, cursorY)
      cursorY += 5
    }
    if (quote.company.address) {
      doc.text(quote.company.address, 14, cursorY)
      cursorY += 5
    }
    if (quote.company.city) {
      doc.text(quote.company.city, 14, cursorY)
      cursorY += 5
    }
    if (quote.company.phone) {
      doc.text(`Tel: ${quote.company.phone}`, 14, cursorY)
      cursorY += 5
    }
    if (quote.company.email) {
      doc.text(`E-posta: ${quote.company.email}`, 14, cursorY)
      cursorY += 5
    }
    if (quote.company.website) {
      doc.text(quote.company.website, 14, cursorY)
      cursorY += 5
    }

    // Teklif Bilgileri (Sağ Üst)
    doc.setFontSize(20)
    doc.setFont(TURKISH_PDF_FONT, "bold")
    doc.text("TEKLİF", 196, 20, { align: "right" })

    doc.setFontSize(10)
    doc.setFont(TURKISH_PDF_FONT, "normal")
    doc.text(`No: ${quote.quoteNo}`, 196, 28, { align: "right" })
    doc.text(
      `Tarih: ${new Date(quote.date).toLocaleDateString("tr-TR")}`,
      196,
      34,
      { align: "right" }
    )
    if (quote.validUntil) {
      doc.text(
        `Geçerlilik: ${new Date(quote.validUntil).toLocaleDateString("tr-TR")}`,
        196,
        40,
        { align: "right" }
      )
    }
    doc.text(`Para Birimi: ${quote.currency || "TRY"}`, 196, 46, { align: "right" })

    // Müşteri / Tedarikçi Bilgileri
    const recipient = quote.customer || quote.supplier
    const headerStartY = Math.max(cursorY + 4, 60)

    doc.setFillColor(240, 240, 240)
    doc.rect(14, headerStartY, 182, 28, "F")

    doc.setFontSize(11)
    doc.setFont(TURKISH_PDF_FONT, "bold")
    doc.text(quote.customer ? "MÜŞTERİ BİLGİLERİ" : "ALICI BİLGİLERİ", 18, headerStartY + 7)

    doc.setFontSize(10)
    doc.setFont(TURKISH_PDF_FONT, "normal")
    if (recipient) {
      // Müşteri adını sol sütuna sığdır (sağdaki VKN/adres sütununa binmesin) — max ~78mm.
      const recipientNameLines: string[] = doc.splitTextToSize(recipient.name || "", 78)
      doc.text(recipientNameLines.slice(0, 2), 18, headerStartY + 14)
      const lines: string[] = []
      if (recipient.taxNumber) {
        const office = recipient.taxOffice ? ` / ${recipient.taxOffice}` : ""
        lines.push(`VKN: ${recipient.taxNumber}${office}`)
      }
      if (recipient.address) lines.push(recipient.address)
      if (recipient.city) lines.push(recipient.city)
      if (recipient.phone) lines.push(`Tel: ${recipient.phone}`)
      if (recipient.email) lines.push(`E-posta: ${recipient.email}`)
      // Sağ sütun satırlarını 93mm'e sar (kutunun sağ kenarını aşmasın), 3 satırla sınırla.
      const wrappedRight: string[] = []
      for (const l of lines) {
        for (const w of doc.splitTextToSize(l, 93) as string[]) wrappedRight.push(w)
      }
      wrappedRight.slice(0, 3).forEach((line, idx) => {
        doc.text(line, 100, headerStartY + 14 + idx * 5)
      })
    } else {
      doc.text("—", 18, headerStartY + 14)
    }

    // Kalemler Tablosu
    const tableStartY = headerStartY + 34
    const tableBody = quote.items.map((item, index) => {
      const qty = Number(item.quantity)
      const unitPrice = Number(item.unitPrice)
      const discount = Number(item.discountAmount || 0)
      const vatRate = Number(item.vatRate)
      const total = Number(item.totalAmount)
      return [
        (index + 1).toString(),
        item.description || "-",
        fmtNumber(qty),
        fmtMoney(unitPrice),
        discount > 0 ? `-${fmtMoney(discount)}` : "-",
        `%${vatRate}`,
        fmtMoney(total),
      ]
    })

    autoTable(doc, {
      startY: tableStartY,
      head: [["#", "Açıklama", "Miktar", "Birim Fiyat", "İskonto", "KDV", "Tutar"]],
      body: tableBody,
      styles: {
        font: TURKISH_PDF_FONT,
        fontSize: 9,
        cellPadding: 3,
      },
      headStyles: {
        font: TURKISH_PDF_FONT,
        fillColor: [59, 130, 246],
        textColor: 255,
        fontStyle: "bold",
      },
      columnStyles: {
        0: { cellWidth: 10, halign: "center" },
        1: { cellWidth: "auto" },
        2: { cellWidth: 24, halign: "right" },
        3: { cellWidth: 30, halign: "right" },
        4: { cellWidth: 26, halign: "right" },
        5: { cellWidth: 16, halign: "center" },
        6: { cellWidth: 30, halign: "right" },
      },
      alternateRowStyles: { fillColor: [249, 250, 251] },
    })

    const finalY = (doc as any).lastAutoTable.finalY + 10

    // Toplamlar
    const totalsX = 130
    doc.setFontSize(10)
    doc.setFont(TURKISH_PDF_FONT, "normal")

    doc.text("Ara Toplam:", totalsX, finalY)
    doc.text(fmtMoney(Number(quote.netAmount)), 196, finalY, { align: "right" })

    const discountTotal = quote.items.reduce(
      (sum, item) => sum + Number(item.discountAmount || 0),
      0
    )
    if (discountTotal > 0) {
      doc.text("İskonto:", totalsX, finalY + 6)
      doc.text(`-${fmtMoney(discountTotal)}`, 196, finalY + 6, { align: "right" })
    }

    doc.text("KDV Toplam:", totalsX, finalY + 12)
    doc.text(fmtMoney(Number(quote.vatAmount)), 196, finalY + 12, { align: "right" })

    doc.setFont(TURKISH_PDF_FONT, "bold")
    doc.setFontSize(12)
    doc.text("GENEL TOPLAM:", totalsX, finalY + 22)
    doc.setTextColor(34, 197, 94)
    doc.text(fmtMoney(Number(quote.totalAmount)), 196, finalY + 22, { align: "right" })
    doc.setTextColor(0, 0, 0)

    let blockY = finalY + 34

    // Banka Hesapları
    if (bankAccounts.length > 0) {
      const pageHeight = doc.internal.pageSize.getHeight()
      const estimatedBankHeight = 10 + bankAccounts.length * 12
      if (blockY + estimatedBankHeight > pageHeight - 25) {
        doc.addPage()
        blockY = 20
      }

      doc.setFont(TURKISH_PDF_FONT, "bold")
      doc.setFontSize(11)
      doc.text("ÖDEME BİLGİLERİ", 14, blockY)
      blockY += 6

      autoTable(doc, {
        startY: blockY,
        head: [["Hesap Adı", "Banka", "IBAN / Hesap No", "Para Birimi"]],
        body: bankAccounts.map((acc) => [
          acc.name,
          acc.bankName || "-",
          acc.iban || acc.accountNumber || "-",
          acc.currency,
        ]),
        styles: {
          font: TURKISH_PDF_FONT,
          fontSize: 9,
          cellPadding: 3,
        },
        headStyles: {
          font: TURKISH_PDF_FONT,
          fillColor: [100, 116, 139],
          textColor: 255,
          fontStyle: "bold",
        },
        columnStyles: {
          0: { cellWidth: 40 },
          1: { cellWidth: 40 },
          2: { cellWidth: "auto" },
          3: { cellWidth: 24, halign: "center" },
        },
      })

      blockY = (doc as any).lastAutoTable.finalY + 8
    }

    // Notlar
    if (quote.notes) {
      const pageHeight = doc.internal.pageSize.getHeight()
      if (blockY + 20 > pageHeight - 20) {
        doc.addPage()
        blockY = 20
      }
      doc.setFont(TURKISH_PDF_FONT, "bold")
      doc.setFontSize(10)
      doc.text("Notlar:", 14, blockY)
      doc.setFont(TURKISH_PDF_FONT, "normal")
      doc.setFontSize(9)
      const wrapped = doc.splitTextToSize(quote.notes, 180)
      doc.text(wrapped, 14, blockY + 6)
    }

    // Alt bilgi
    const pageCount = (doc as any).internal.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setFont(TURKISH_PDF_FONT, "normal")
      doc.setFontSize(8)
      doc.setTextColor(128, 128, 128)
      doc.text(
        `Bu teklif ${new Date().toLocaleString("tr-TR")} tarihinde oluşturulmuştur.`,
        14,
        287
      )
      doc.text(`Sayfa ${i} / ${pageCount}`, 196, 287, { align: "right" })
      doc.setTextColor(0, 0, 0)
    }

    const pdfBuffer = Buffer.from(doc.output("arraybuffer"))

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Teklif_${quote.quoteNo}.pdf"`,
      },
    })
  } catch (error: any) {
    if (error?.message?.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error generating quote PDF:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
