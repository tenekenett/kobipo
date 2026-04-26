import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { createEInvoiceProvider } from "@/lib/integrations/e-invoice/factory"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { Decimal } from "@prisma/client/runtime/library"


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

    // Recalculate totals if items changed
    let netAmount: Decimal = invoice.netAmount
    let vatAmount: Decimal = invoice.vatAmount
    let totalAmount: Decimal = invoice.totalAmount

    if (items && items.length > 0) {
      netAmount = new Decimal(0)
      vatAmount = new Decimal(0)
      totalAmount = new Decimal(0)

      items.forEach((item: any) => {
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
    if (items && items.length > 0) {
      // Delete existing items
      await prisma.invoiceItem.deleteMany({
        where: { invoiceId: resolvedParams.id },
      })

      // Create new items
      await prisma.invoiceItem.createMany({
        data: items.map((item: any, index: number) => ({
          invoiceId: resolvedParams.id,
          productId: item.productId || null,
          description: item.description,
          unit:
            typeof item.unit === "string" && item.unit.trim()
              ? String(item.unit).trim().toUpperCase()
              : "ADET",
          quantity: new Decimal(item.quantity),
          unitPrice: new Decimal(item.unitPrice),
          discountRate: item.discountRate !== undefined ? new Decimal(item.discountRate) : null,
          discountAmount: new Decimal(item.quantity).times(item.unitPrice).times(new Decimal(item.discountRate || 0).div(100)),
          vatRate: new Decimal(item.vatRate),
          vatAmount: new Decimal(item.quantity)
            .times(item.unitPrice)
            .times(new Decimal(1).minus(new Decimal(item.discountRate || 0).div(100)))
            .times(new Decimal(item.vatRate).div(100)),
          withholdingRate: item.withholdingRate !== undefined ? new Decimal(item.withholdingRate) : null,
          withholdingAmount: new Decimal(item.quantity)
            .times(item.unitPrice)
            .times(new Decimal(1).minus(new Decimal(item.discountRate || 0).div(100)))
            .times(new Decimal(item.withholdingRate || 0).div(100)),
          exciseRate: item.exciseRate !== undefined ? new Decimal(item.exciseRate) : null,
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

