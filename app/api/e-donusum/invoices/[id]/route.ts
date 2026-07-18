import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { createGibDraft } from "@/lib/integrations/e-invoice/send-invoice-helper"
import { revertInvoiceStock } from "@/lib/stock/warehouse"
import { resolveSlugId } from "@/lib/slug-resolve"
import { Decimal } from "@prisma/client/runtime/library"


export const dynamic = 'force-dynamic'

function isMeaningfulInvoiceItem(item: any) {
  if (!item || typeof item !== "object") return false
  const hasProduct = typeof item.productId === "string" && item.productId.trim() !== ""
  const quantity = parseFloat(item.quantity) || 0
  const unitPrice = parseFloat(item.unitPrice) || 0
  const hasDescription = typeof item.description === "string" && item.description.trim() !== ""
  return hasProduct || quantity > 0 || unitPrice > 0 || hasDescription
}

function normalizeInvoiceItem(item: any) {
  return {
    productId: item.productId || null,
    description: typeof item.description === "string" ? String(item.description).trim() : "",
    unit:
      typeof item.unit === "string" && item.unit.trim()
        ? String(item.unit).trim().toUpperCase()
        : "ADET",
    quantity: parseFloat(item.quantity) || 0,
    unitPrice: parseFloat(item.unitPrice) || 0,
    discountRate: parseFloat(item.discountRate) || 0,
    discountAmount: parseFloat(item.discountAmount) || 0,
    discountMode:
      typeof item.discountMode === "string" && item.discountMode.toUpperCase() === "AMOUNT"
        ? "AMOUNT"
        : "PERCENT",
    vatRate: parseFloat(item.vatRate) || 0,
    withholdingRate: parseFloat(item.withholdingRate) || 0,
    withholdingCode:
      typeof item.withholdingCode === "string" && item.withholdingCode.trim()
        ? item.withholdingCode.trim()
        : null,
    withholdingName:
      typeof item.withholdingName === "string" && item.withholdingName.trim()
        ? item.withholdingName.trim()
        : null,
    exciseRate: parseFloat(item.exciseRate) || 0,
    // ÖTV GİB liste kodu (0071/0073/0074...). GİB payload'ında tax[].taxCode.
    exciseCode:
      typeof item.exciseCode === "string" && item.exciseCode.trim()
        ? item.exciseCode.trim()
        : null,
    // KDV dışı "Diğer Vergi" (ör. Konaklama Vergisi): matrahın üzerine eklenir.
    otherTaxRate: parseFloat(item.otherTaxRate) || 0,
    otherTaxName:
      typeof item.otherTaxName === "string" && item.otherTaxName.trim()
        ? item.otherTaxName.trim()
        : null,
    // Diğer Vergi GİB kodu (0059/4071/4080). GİB payload'ında tax[].taxCode.
    otherTaxCode:
      typeof item.otherTaxCode === "string" && item.otherTaxCode.trim()
        ? item.otherTaxCode.trim()
        : null,
    taxExemptionReasonCode:
      typeof item.taxExemptionReasonCode === "string" && item.taxExemptionReasonCode.trim()
        ? item.taxExemptionReasonCode.trim()
        : null,
    taxExemptionReason:
      typeof item.taxExemptionReason === "string" && item.taxExemptionReason.trim()
        ? item.taxExemptionReason.trim()
        : null,
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

    const resolvedParams = await params
    resolvedParams.id = await resolveSlugId("invoice", resolvedParams.id, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))
    const { searchParams } = new URL(request.url)
    const queryCompanyId = (await resolveCompanyId(searchParams.get("companyId")))?.trim() || null

    const invoice = await prisma.invoice.findUnique({
      where: { id: resolvedParams.id },
      include: {
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
        customer: true,
        supplier: true,
        items: {
          include: {
            product: true,
          },
          orderBy: { order: "asc" },
        },
        payments: {
          include: {
            account: {
              select: {
                id: true,
                name: true,
                type: true,
              },
            },
          },
          orderBy: {
            paymentDate: "desc",
          },
        },
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    await ensureCompanyAccess(invoice.companyId)

    if (queryCompanyId && queryCompanyId !== invoice.companyId) {
      return NextResponse.json(
        {
          error:
            "Bu fatura URL'deki firmaya ait değil. Üstten doğru şubeyi seçin veya Faturalar listesinden açın.",
          code: "COMPANY_MISMATCH",
        },
        { status: 400 }
      )
    }
    const company = await prisma.company.findUnique({
      where: { id: invoice.companyId },
      select: { isEDonusumEnabled: true },
    })
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 })
    }

    // Gelen e-faturadan dönüştürülmüşse kaynak bilgisini ekle (preview'de "Geri"
    // butonu ve UI farklılıkları için).
    const incomingSource = await prisma.incomingInvoice.findFirst({
      where: { linkedInvoiceId: invoice.id },
      select: {
        uuid: true,
        invoiceNo: true,
        senderName: true,
        senderTaxNumber: true,
        profile: true,
      },
    })

    return NextResponse.json({
      ...invoice,
      profile: incomingSource?.profile ?? null,
      incomingSource: incomingSource
        ? {
            uuid: incomingSource.uuid,
            invoiceNo: incomingSource.invoiceNo,
            profile: incomingSource.profile,
            sender: {
              name: incomingSource.senderName,
              taxNumber: incomingSource.senderTaxNumber,
            },
          }
        : null,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching invoice:", error)
    return NextResponse.json(
      { error: message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    resolvedParams.id = await resolveSlugId("invoice", resolvedParams.id, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))
    const invoice = await prisma.invoice.findUnique({
      where: { id: resolvedParams.id },
    })

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    await ensureCompanyAccess(invoice.companyId)

    if (invoice.status !== "DRAFT") {
      return NextResponse.json(
        { error: "Only draft invoices can be updated" },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { customerId, supplierId, date, dueDate, items, notes, globalDiscountAmount } = body

    const normalizedItems =
      Array.isArray(items) && items.length > 0
        ? items.filter((item: any) => isMeaningfulInvoiceItem(item)).map((item: any) => normalizeInvoiceItem(item))
        : null

    if (Array.isArray(items) && items.length > 0 && normalizedItems && normalizedItems.length === 0) {
      return NextResponse.json(
        { error: "En az bir anlamlı fatura kalemi gerekli" },
        { status: 400 }
      )
    }

    // Recalculate totals if items changed
    let netAmount: Decimal = invoice.netAmount
    let vatAmount: Decimal = invoice.vatAmount
    let totalAmount: Decimal = invoice.totalAmount

    // Satır iskonto: mod AMOUNT ise tutar (brüt-aşan/negatif normalize edilir),
    // PERCENT ise oran. PUT yolunda Decimal kullanılır.
    const itemDiscountDec = (item: { quantity: number; unitPrice: number; discountRate: number; discountAmount: number; discountMode: string }) => {
      const gross = new Decimal(item.quantity).times(item.unitPrice)
      if (item.discountMode === "AMOUNT") {
        const raw = new Decimal(item.discountAmount || 0)
        const clampedMax = raw.gt(gross) ? gross : raw
        return clampedMax.lt(0) ? new Decimal(0) : clampedMax
      }
      return gross.times(new Decimal(item.discountRate || 0).div(100))
    }

    if (normalizedItems && normalizedItems.length > 0) {
      netAmount = new Decimal(0)
      vatAmount = new Decimal(0)
      totalAmount = new Decimal(0)

      normalizedItems.forEach((item) => {
        const itemGross = new Decimal(item.quantity).times(item.unitPrice)
        const itemDiscount = itemDiscountDec(item)
        const itemNet = itemGross.minus(itemDiscount)
        const itemVat = itemNet.times(new Decimal(item.vatRate).div(100))
        // KDV tevkifatı: tevkif edilen tutar KDV üzerinden hesaplanır (matrah değil).
        const itemWithholding = itemVat.times(new Decimal(item.withholdingRate || 0).div(100))
        const itemExcise = itemNet.times(new Decimal(item.exciseRate || 0).div(100))
        const itemOtherTax = itemNet.times(new Decimal(item.otherTaxRate || 0).div(100))
        const itemTotal = itemNet.plus(itemVat).plus(itemExcise).plus(itemOtherTax).minus(itemWithholding)

        netAmount = netAmount.plus(itemNet)
        vatAmount = vatAmount.plus(itemVat)
        totalAmount = totalAmount.plus(itemTotal)
      })
    }

    // Fatura altı (genel) iskonto: matrahtan oransal düşülür → KDV/total da aynı
    // oranda azalır. body'de globalDiscountAmount yoksa mevcut faturadakini koru.
    const incomingGlobalDiscount =
      globalDiscountAmount !== undefined
        ? new Decimal(Math.max(0, parseFloat(String(globalDiscountAmount)) || 0))
        : invoice.globalDiscountAmount
          ? new Decimal(invoice.globalDiscountAmount.toString())
          : new Decimal(0)
    const appliedGlobalDiscount = netAmount.gt(0)
      ? incomingGlobalDiscount.gt(netAmount) ? netAmount : incomingGlobalDiscount
      : new Decimal(0)
    if (appliedGlobalDiscount.gt(0) && netAmount.gt(0)) {
      const adjustment = new Decimal(1).minus(appliedGlobalDiscount.div(netAmount))
      netAmount = netAmount.minus(appliedGlobalDiscount)
      vatAmount = vatAmount.times(adjustment)
      totalAmount = totalAmount.times(adjustment)
    }

    const updated = await prisma.invoice.update({
      where: { id: resolvedParams.id },
      data: {
        customerId: customerId !== undefined ? (customerId || null) : invoice.customerId,
        supplierId: supplierId !== undefined ? (supplierId || null) : invoice.supplierId,
        date: date ? new Date(date) : invoice.date,
        dueDate: dueDate !== undefined ? (dueDate ? new Date(dueDate) : null) : invoice.dueDate,
        totalAmount: totalAmount,
        vatAmount: vatAmount,
        netAmount: netAmount,
        globalDiscountAmount: appliedGlobalDiscount.gt(0) ? appliedGlobalDiscount : null,
        notes: notes !== undefined ? notes : invoice.notes,
      },
    })

    // Update items if provided
    if (normalizedItems && normalizedItems.length > 0) {
      // Delete existing items
      await prisma.invoiceItem.deleteMany({
        where: { invoiceId: resolvedParams.id },
      })

      // Create new items
      await prisma.invoiceItem.createMany({
        data: normalizedItems.map((item, index: number) => {
          const gross = new Decimal(item.quantity).times(item.unitPrice)
          const disc = itemDiscountDec(item)
          const net = gross.minus(disc)
          return {
            invoiceId: resolvedParams.id,
            productId: item.productId || null,
            description: item.description,
            unit: item.unit,
            quantity: new Decimal(item.quantity),
            unitPrice: new Decimal(item.unitPrice),
            discountRate: item.discountMode === "AMOUNT" ? null : new Decimal(item.discountRate),
            discountAmount: disc,
            vatRate: new Decimal(item.vatRate),
            vatAmount: net.times(new Decimal(item.vatRate).div(100)),
            withholdingCode: item.withholdingCode,
            withholdingName: item.withholdingName,
            withholdingRate: new Decimal(item.withholdingRate),
            // Tevkifat KDV üzerinden: net × vatRate/100 × withholdingRate/100
            withholdingAmount: net
              .times(new Decimal(item.vatRate).div(100))
              .times(new Decimal(item.withholdingRate || 0).div(100)),
            exciseRate: new Decimal(item.exciseRate),
            exciseCode: item.exciseCode || null,
            exciseAmount: net.times(new Decimal(item.exciseRate || 0).div(100)),
            otherTaxRate: item.otherTaxRate ? new Decimal(item.otherTaxRate) : null,
            otherTaxAmount: net.times(new Decimal(item.otherTaxRate || 0).div(100)),
            otherTaxName: item.otherTaxName,
            otherTaxCode: item.otherTaxCode || null,
            totalAmount: net
              .times(
                new Decimal(1)
                  .plus(new Decimal(item.vatRate).div(100))
                  .plus(new Decimal(item.exciseRate || 0).div(100))
                  .plus(new Decimal(item.otherTaxRate || 0).div(100)),
              )
              .minus(
                net
                  .times(new Decimal(item.vatRate).div(100))
                  .times(new Decimal(item.withholdingRate || 0).div(100)),
              ),
            taxExemptionReasonCode: item.taxExemptionReasonCode,
            taxExemptionReason: item.taxExemptionReason,
            order: index,
          }
        }),
      })
    }

    const invoiceWithItems = await prisma.invoice.findUnique({
      where: { id: resolvedParams.id },
      include: {
        customer: true,
        supplier: true,
        items: {
          include: {
            product: true,
          },
          orderBy: { order: "asc" },
        },
      },
    })

    return NextResponse.json(invoiceWithItems)
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error updating invoice:", error)
    return NextResponse.json(
      { error: message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    resolvedParams.id = await resolveSlugId("invoice", resolvedParams.id, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))

    // Yetki kontrolü için faturanın companyId'sini önce çek.
    const existing = await prisma.invoice.findUnique({
      where: { id: resolvedParams.id },
      select: { companyId: true, uuid: true, status: true },
    })
    if (!existing) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }
    await ensureCompanyAccess(existing.companyId)

    // Tekrar koruması: taslakta uuid dolu olsa da "gönderilmiş" DEĞİL — ayrım status ile.
    if (existing.status === "SENT") {
      return NextResponse.json(
        { error: "Bu fatura zaten Mysoft'a gönderilmiş. Yeniden göndermek için önce iptal edin." },
        { status: 400 }
      )
    }
    if (existing.status === "GIB_DRAFT") {
      return NextResponse.json(
        { error: "Bu fatura için zaten bir GİB taslağı var. Taslağı kesinleştirin veya geri alın." },
        { status: 400 }
      )
    }

    // İstemci E-Fatura için Ticari/Temel profili seçebilir.
    const body = await request.json().catch(() => ({}))
    const eInvoiceProfile =
      body?.eInvoiceProfile === "TEMELFATURA" || body?.eInvoiceProfile === "TICARIFATURA"
        ? body.eInvoiceProfile
        : undefined

    const result = await createGibDraft(resolvedParams.id, { eInvoiceProfile })
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, integrationStatus: result.integrationStatus },
        { status: result.status }
      )
    }

    const updated = await prisma.invoice.findUnique({
      where: { id: resolvedParams.id },
    })
    return NextResponse.json({
      success: true,
      uuid: result.uuid,
      integrationId: result.providerName,
      invoice: updated,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error resending invoice:", error)
    return NextResponse.json(
      { error: message || "Internal server error" },
      { status: 500 }
    )
  }
}
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    resolvedParams.id = await resolveSlugId("invoice", resolvedParams.id, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))
    const invoiceId = resolvedParams.id

    // 1. Silinecek faturayı, içindeki ürünlerle (items) ve stokla bağlantılı olarak çekelim
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        items: true,
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    await ensureCompanyAccess(invoice.companyId)

    // NOT: GİB'e gönderilmiş (uuid/ETTN) fatura da FİZİKSEL silinebilir. Bu silme
    // yalnızca Kobipo'daki LOKAL (ön muhasebe / cari) kaydı kaldırır; GİB'deki resmi
    // e-Fatura/e-Arşiv belgesine DOKUNMAZ (iptal etmez). Kullanıcı bu ayrımı silme
    // onay ekranındaki uyarıyla teyit eder; stok ve cari bakiye normal şekilde geri alınır.

    // 2-4. Stok iadesi + yan etkiler + faturanın kendisi tek atomik transaction'da.
    // Stok geri alma artık `revertInvoiceStock` ile yapılıyor: depo bazlı (WarehouseStock)
    // güncellenir, Σ(WarehouseStock)=Product.stockQuantity değişmezi korunur ve
    // idempotenttir (zaten iptal edilip stoğu geri alınmış faturayı silmek çift
    // geri alma yapmaz). Bağlı InvoiceItem/InvoicePayment/PaymentLink/Waybill
    // kayıtları şemada onDelete: Cascade olduğu için fatura silinince otomatik gider.
    try {
      await prisma.$transaction(async (tx) => {
        await revertInvoiceStock(tx, {
          companyId: invoice.companyId,
          invoiceId,
          invoiceNo: invoice.invoiceNo,
          createdBy: user.id,
        })

        // İlgili otomatik muhasebe fişlerini (AccountingEntry) sil (varsa).
        await tx.accountingEntry.deleteMany({
          where: {
            companyId: invoice.companyId,
            reference: invoice.id,
            referenceType: { in: ["INVOICE_AUTO", "INVOICE_AUTO_VAT"] },
          },
        })

        // Bu fatura bir gelen e-faturadan dönüştürülmüşse, kaynak kaydın bağlantısını
        // çöz → gelen e-fatura tekrar "Alış Faturasına Dönüştür" edilebilir hale gelsin.
        // (Aksi halde silinen faturaya bağlı kalıp "dönüştürülmüş" görünmeye devam eder.)
        await tx.incomingInvoice.updateMany({
          where: { linkedInvoiceId: invoiceId },
          data: { isLinkedToPurchase: false, linkedInvoiceId: null },
        })

        // Son olarak faturayı sil (bağlı kayıtlar cascade ile temizlenir).
        await tx.invoice.delete({ where: { id: invoiceId } })
      })
    } catch (deleteError: any) {
      if (deleteError?.code === "P2025") {
        // Fatura zaten silinmiş (çift tıklama / yarış durumu): başarı say.
        console.warn(`[Silme Uyarısı] Fatura zaten silinmiş veya bulunamadı. ID: ${invoiceId}`)
        return NextResponse.json({ success: true, message: "Fatura zaten silinmiş." })
      }
      throw deleteError
    }

    return NextResponse.json({ success: true, message: "Fatura ve stok hareketleri silindi/geri alındı." })
  } catch (error: any) {
    console.error("Error deleting invoice:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
