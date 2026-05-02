import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { createEInvoiceProvider } from "@/lib/integrations/e-invoice/factory"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
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
    vatRate: parseFloat(item.vatRate) || 0,
    withholdingRate: parseFloat(item.withholdingRate) || 0,
    exciseRate: parseFloat(item.exciseRate) || 0,
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
    const { searchParams } = new URL(request.url)
    const queryCompanyId = searchParams.get("companyId")?.trim() || null

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

    return NextResponse.json(invoice)
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
    const { customerId, supplierId, date, dueDate, items, notes } = body

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

    if (normalizedItems && normalizedItems.length > 0) {
      netAmount = new Decimal(0)
      vatAmount = new Decimal(0)
      totalAmount = new Decimal(0)

      normalizedItems.forEach((item) => {
        const itemGross = new Decimal(item.quantity).times(item.unitPrice)
        const itemDiscount = itemGross.times(new Decimal(item.discountRate || 0).div(100))
        const itemNet = itemGross.minus(itemDiscount)
        const itemVat = itemNet.times(new Decimal(item.vatRate).div(100))
        const itemWithholding = itemNet.times(new Decimal(item.withholdingRate || 0).div(100))
        const itemExcise = itemNet.times(new Decimal(item.exciseRate || 0).div(100))
        const itemTotal = itemNet.plus(itemVat).plus(itemExcise).minus(itemWithholding)

        netAmount = netAmount.plus(itemNet)
        vatAmount = vatAmount.plus(itemVat)
        totalAmount = totalAmount.plus(itemTotal)
      })
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
        data: normalizedItems.map((item, index: number) => ({
          invoiceId: resolvedParams.id,
          productId: item.productId || null,
          description: item.description,
          unit: item.unit,
          quantity: new Decimal(item.quantity),
          unitPrice: new Decimal(item.unitPrice),
          discountRate: new Decimal(item.discountRate),
          discountAmount: new Decimal(item.quantity).times(item.unitPrice).times(new Decimal(item.discountRate || 0).div(100)),
          vatRate: new Decimal(item.vatRate),
          vatAmount: new Decimal(item.quantity)
            .times(item.unitPrice)
            .times(new Decimal(1).minus(new Decimal(item.discountRate || 0).div(100)))
            .times(new Decimal(item.vatRate).div(100)),
          withholdingRate: new Decimal(item.withholdingRate),
          withholdingAmount: new Decimal(item.quantity)
            .times(item.unitPrice)
            .times(new Decimal(1).minus(new Decimal(item.discountRate || 0).div(100)))
            .times(new Decimal(item.withholdingRate || 0).div(100)),
          exciseRate: new Decimal(item.exciseRate),
          exciseAmount: new Decimal(item.quantity)
            .times(item.unitPrice)
            .times(new Decimal(1).minus(new Decimal(item.discountRate || 0).div(100)))
            .times(new Decimal(item.exciseRate || 0).div(100)),
          totalAmount: new Decimal(item.quantity)
            .times(item.unitPrice)
            .times(new Decimal(1).minus(new Decimal(item.discountRate || 0).div(100)))
            .times(
              new Decimal(1)
                .plus(new Decimal(item.vatRate).div(100))
                .plus(new Decimal(item.exciseRate || 0).div(100))
                .minus(new Decimal(item.withholdingRate || 0).div(100))
            ),
          order: index,
        })),
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
    const invoiceWithItems = await prisma.invoice.findUnique({
      where: { id: resolvedParams.id },
      include: {
        customer: true,
        supplier: true,
        items: true,
      },
    })

    if (!invoiceWithItems) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    await ensureCompanyAccess(invoiceWithItems.companyId)
    const company = await prisma.company.findUnique({
      where: { id: invoiceWithItems.companyId },
      select: { isEDonusumEnabled: true },
    })
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 })
    }

    if (invoiceWithItems.status !== "DRAFT") {
      return NextResponse.json(
        { error: "Only draft invoices can be sent" },
        { status: 400 }
      )
    }

    if (invoiceWithItems.invoiceType !== "E_INVOICE" && invoiceWithItems.invoiceType !== "E_ARCHIVE") {
      return NextResponse.json(
        { error: "Only E-Invoice or E-Archive invoices can be sent" },
        { status: 400 }
      )
    }

    if (!company.isEDonusumEnabled) {
      return NextResponse.json(
        { error: "Bu firmada e-fatura ozelligi kapali" },
        { status: 400 }
      )
    }

    if (invoiceWithItems.type !== "SALES") {
      return NextResponse.json(
        { error: "Only sales invoices can be sent" },
        { status: 400 }
      )
    }

    assertEInvoiceRuntimeReady()
    const provider = createEInvoiceProvider()
    const invoiceData = {
      invoiceNo: invoiceWithItems.invoiceNo,
      date: invoiceWithItems.date,
      dueDate: invoiceWithItems.dueDate || undefined,
      customer: invoiceWithItems.customer
        ? {
            name: invoiceWithItems.customer.name,
            taxNumber: invoiceWithItems.customer.taxNumber || undefined,
            taxOffice: invoiceWithItems.customer.taxOffice || undefined,
            address: invoiceWithItems.customer.address || undefined,
            city: invoiceWithItems.customer.city || undefined,
            country: invoiceWithItems.customer.country || undefined,
          }
        : undefined,
      supplier: invoiceWithItems.supplier
        ? {
            name: invoiceWithItems.supplier.name,
            taxNumber: invoiceWithItems.supplier.taxNumber || undefined,
            taxOffice: invoiceWithItems.supplier.taxOffice || undefined,
            address: invoiceWithItems.supplier.address || undefined,
            city: invoiceWithItems.supplier.city || undefined,
            country: invoiceWithItems.supplier.country || undefined,
          }
        : undefined,
      items: invoiceWithItems.items.map((item) => ({
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        vatRate: Number(item.vatRate),
        productId: item.productId || undefined,
      })),
      notes: invoiceWithItems.notes || undefined,
    }

    const response = await provider.sendInvoice(invoiceData)

    if (!response.success) {
      await prisma.invoice.update({
        where: { id: resolvedParams.id },
        data: { integrationStatus: `ERROR:${response.error || "UNKNOWN"}` },
      })
      return NextResponse.json(
        { error: response.error || "Failed to send invoice" },
        { status: 400 }
      )
    }

    const updated = await prisma.invoice.update({
      where: { id: resolvedParams.id },
      data: {
        uuid: response.uuid,
        status: "SENT",
        integrationId: provider.name,
        integrationStatus: "SENT",
      },
    })

    return NextResponse.json(updated)
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error sending invoice:", error)
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

    // Sadece DRAFT (Taslak) veya iptal edilmiş faturaların silinmesine izin verebilirsin, 
    // ama sistem yöneticisiysen her faturayı silebilirsin. Şimdilik sınır koymuyoruz, 
    // ama istersen `if (invoice.status === 'SENT') return error` diyebilirsin.

    const safeType = String(invoice.type || "").trim().toUpperCase()

    // 2. Stokları GERİ İADE ETME MANTIĞI
    for (const item of invoice.items) {
      const safeProductId = item.productId || null
      if (!safeProductId) continue // Ürün ID yoksa geç

      let stockQuantityChange = 0
      let moveType = "UNKNOWN"

      // DİKKAT: Oluşturmanın TAM TERSİNİ yapıyoruz!
      if (safeType === "SALES") {
        stockQuantityChange = Number(item.quantity) // Satış silindi: Stoğa Geri Ekle (+)
        moveType = "SALE_CANCEL"
      } else if (safeType === "PURCHASE") {
        stockQuantityChange = -Number(item.quantity) // Alış silindi: Stoktan Geri Çıkar (-)
        moveType = "PURCHASE_CANCEL"
      } else if (safeType === "RETURN") {
        stockQuantityChange = -Number(item.quantity) // İade silindi: Stoktan Geri Çıkar (-)
        moveType = "RETURN_CANCEL"
      }

      if (stockQuantityChange !== 0) {
        try {
          // Geri iade hareketi (StockMovement) oluştur
          await prisma.stockMovement.create({
            data: {
              companyId: invoice.companyId,
              productId: safeProductId,
              type: moveType,
              quantity: stockQuantityChange,
              description: `${invoice.invoiceNo} numaralı faturanın silinmesi (İptal)`,
              reference: invoice.id,
              createdBy: user.id,
            },
          })

          // Ürünün mevcut stoğunu güncelle
          await prisma.product.update({
            where: { id: safeProductId },
            data: {
              stockQuantity: {
                increment: stockQuantityChange,
              },
            },
          })
          
        } catch (stockError) {
          console.error(`[Stok İade Hatası] ${safeProductId} iade edilirken hata:`, stockError)
        }
      }
    }

    // 3. İlgili otomatik muhasebe fişlerini (AccountingEntry) sil (varsa)
    // Otomatik muhasebe fişlerini 'reference' ve 'referenceType' ile bulup temizleyebiliriz
    try {
       await prisma.accountingEntry.deleteMany({
          where: { 
             companyId: invoice.companyId,
             reference: invoice.id,
             referenceType: { in: ["INVOICE_AUTO", "INVOICE_AUTO_VAT"] }
          }
       });
    } catch(accError) {
       console.log("Muhasebe fişi silinirken hata veya fiş yok:", accError);
    }

    // 4. Son olarak Faturayı veritabanından tamamen sil
    // Çift tıklama / ağ gecikmesi durumunda uygulamanın çökmemesi için try-catch
    try {
      await prisma.invoice.delete({
        where: { id: invoiceId },
      });
    } catch (deleteError: any) {
      if (deleteError.code === 'P2025') {
        console.warn(`[Silme Uyarısı] Fatura zaten silinmiş veya bulunamadı. ID: ${invoiceId}`);
        // Fatura zaten yoksa, stok hareketlerini de yapıp yapmadığımıza bakmaksızın başarılı dönüyoruz
        return NextResponse.json({ success: true, message: "Fatura zaten silinmiş." });
      }
      throw deleteError; // Eğer P2025 (kayıt yok) dışında bir hataysa yukarıya fırlat
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
