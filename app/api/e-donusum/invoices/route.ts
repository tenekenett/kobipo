import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { createEInvoiceProvider } from "@/lib/integrations/e-invoice/factory"
import { generateInvoiceNumber } from "@/lib/utils/invoice-number"

export const dynamic = 'force-dynamic'


export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get("companyId")
    const type = searchParams.get("type")
    const status = searchParams.get("status")

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    const where: any = {
      companyId,
    }

    if (type) {
      where.type = type
    }

    if (status) {
      where.status = status
    }

    const invoices = await prisma.invoice.findMany({
      where,
      include: {
        customer: true,
        supplier: true,
        items: {
          include: {
            product: true,
          },
        },
        payments: {
          select: {
            amount: true,
          },
        },
      },
      orderBy: { date: "desc" },
    })

    return NextResponse.json(invoices)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching invoices:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const {
      companyId,
      invoiceNo,
      type,
      invoiceType,
      customerId,
      supplierId,
      date,
      dueDate,
      items,
      notes,
      sendInvoice,
    } = body

    if (!companyId || !type || !invoiceType || !items || items.length === 0) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    // Fatura numarası yoksa otomatik oluştur
    let finalInvoiceNo = invoiceNo
    if (!finalInvoiceNo) {
      finalInvoiceNo = await generateInvoiceNumber(
        companyId,
        type as "SALES" | "PURCHASE",
        date ? new Date(date) : undefined
      )
    }

    // Calculate totals
    let netAmount = 0
    let vatAmount = 0
    let totalAmount = 0

    items.forEach((item: any) => {
      const itemNet = item.quantity * item.unitPrice
      const itemVat = itemNet * (item.vatRate / 100)
      const itemTotal = itemNet + itemVat

      netAmount += itemNet
      vatAmount += itemVat
      totalAmount += itemTotal
    })

    // Create invoice
    const invoice = await prisma.invoice.create({
      data: {
        companyId,
        invoiceNo: finalInvoiceNo,
        type,
        invoiceType,
        customerId: customerId || null,
        supplierId: supplierId || null,
        date: new Date(date),
        dueDate: dueDate ? new Date(dueDate) : null,
        totalAmount,
        vatAmount,
        netAmount,
        notes,
        status: "DRAFT",
        createdBy: user.id,
        items: {
          create: items.map((item: any, index: number) => ({
            productId: item.productId || null,
            description: item.description,
            quantity: parseFloat(item.quantity),
            unitPrice: parseFloat(item.unitPrice),
            vatRate: parseFloat(item.vatRate),
            vatAmount: item.quantity * item.unitPrice * (item.vatRate / 100),
            totalAmount: item.quantity * item.unitPrice * (1 + item.vatRate / 100),
            order: index,
          })),
        },
      },
      include: {
        customer: true,
        supplier: true,
        items: true,
      },
    })

    // Send invoice if requested
    if (sendInvoice && (invoiceType === "E_INVOICE" || invoiceType === "E_ARCHIVE")) {
      try {
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

        if (response.success && response.uuid) {
          await prisma.invoice.update({
            where: { id: invoice.id },
            data: {
              uuid: response.uuid,
              status: "SENT",
              integrationId: provider.name,
              integrationStatus: "SENT",
            },
          })

          return NextResponse.json({
            ...invoice,
            uuid: response.uuid,
            status: "SENT",
          })
        }
      } catch (error) {
        console.error("Error sending invoice:", error)
        // Continue with invoice creation even if sending fails
      }
    }

    return NextResponse.json(invoice, { status: 201 })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error creating invoice:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

