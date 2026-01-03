import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { createEInvoiceProvider } from "@/lib/integrations/e-invoice/factory"

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: params.id },
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

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    await ensureCompanyAccess(invoice.companyId)

    return NextResponse.json(invoice)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching invoice:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: params.id },
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
    let netAmount = invoice.netAmount
    let vatAmount = invoice.vatAmount
    let totalAmount = invoice.totalAmount

    if (items && items.length > 0) {
      netAmount = 0
      vatAmount = 0
      totalAmount = 0

      items.forEach((item: any) => {
        const itemNet = item.quantity * item.unitPrice
        const itemVat = itemNet * (item.vatRate / 100)
        const itemTotal = itemNet + itemVat

        netAmount += itemNet
        vatAmount += itemVat
        totalAmount += itemTotal
      })
    }

    // Update invoice
    const updated = await prisma.invoice.update({
      where: { id: params.id },
      data: {
        customerId: customerId !== undefined ? customerId : invoice.customerId,
        supplierId: supplierId !== undefined ? supplierId : invoice.supplierId,
        date: date ? new Date(date) : invoice.date,
        dueDate: dueDate !== undefined ? (dueDate ? new Date(dueDate) : null) : invoice.dueDate,
        totalAmount,
        vatAmount,
        netAmount,
        notes: notes !== undefined ? notes : invoice.notes,
      },
    })

    // Update items if provided
    if (items && items.length > 0) {
      // Delete existing items
      await prisma.invoiceItem.deleteMany({
        where: { invoiceId: params.id },
      })

      // Create new items
      await prisma.invoiceItem.createMany({
        data: items.map((item: any, index: number) => ({
          invoiceId: params.id,
          productId: item.productId || null,
          description: item.description,
          quantity: parseFloat(item.quantity),
          unitPrice: parseFloat(item.unitPrice),
          vatRate: parseFloat(item.vatRate),
          vatAmount: item.quantity * item.unitPrice * (item.vatRate / 100),
          totalAmount: item.quantity * item.unitPrice * (1 + item.vatRate / 100),
          order: index,
        })),
      })
    }

    const invoiceWithItems = await prisma.invoice.findUnique({
      where: { id: params.id },
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
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error updating invoice:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: params.id },
      include: {
        customer: true,
        supplier: true,
        items: true,
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    await ensureCompanyAccess(invoice.companyId)

    if (invoice.status !== "DRAFT") {
      return NextResponse.json(
        { error: "Only draft invoices can be sent" },
        { status: 400 }
      )
    }

    if (invoice.invoiceType !== "E_INVOICE" && invoice.invoiceType !== "E_ARCHIVE") {
      return NextResponse.json(
        { error: "Only E-Invoice or E-Archive invoices can be sent" },
        { status: 400 }
      )
    }

    const provider = createEInvoiceProvider()
    const invoiceData = {
      invoiceNo: invoice.invoiceNo,
      date: invoice.date,
      dueDate: invoice.dueDate || undefined,
      customer: invoice.customer
        ? {
            name: invoice.customer.name,
            taxNumber: invoice.customer.taxNumber || undefined,
            taxOffice: invoice.customer.taxOffice || undefined,
            address: invoice.customer.address || undefined,
            city: invoice.customer.city || undefined,
            country: invoice.customer.country || undefined,
          }
        : undefined,
      supplier: invoice.supplier
        ? {
            name: invoice.supplier.name,
            taxNumber: invoice.supplier.taxNumber || undefined,
            taxOffice: invoice.supplier.taxOffice || undefined,
            address: invoice.supplier.address || undefined,
            city: invoice.supplier.city || undefined,
            country: invoice.supplier.country || undefined,
          }
        : undefined,
      items: invoice.items.map((item) => ({
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        vatRate: Number(item.vatRate),
        productId: item.productId || undefined,
      })),
      notes: invoice.notes || undefined,
    }

    const response = await provider.sendInvoice(invoiceData)

    if (!response.success) {
      return NextResponse.json(
        { error: response.error || "Failed to send invoice" },
        { status: 400 }
      )
    }

    const updated = await prisma.invoice.update({
      where: { id: params.id },
      data: {
        uuid: response.uuid,
        status: "SENT",
        integrationId: provider.name,
        integrationStatus: "SENT",
      },
    })

    return NextResponse.json(updated)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error sending invoice:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

