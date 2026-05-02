import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { generateInvoiceNumber } from "@/lib/utils/invoice-number"

export const dynamic = "force-dynamic"

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const quote = await prisma.quote.findUnique({
    where: { id },
    include: { items: true },
  })
  if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 })

  await ensureCompanyAccess(quote.companyId)

  if (quote.convertedInvoiceId) {
    return NextResponse.json({ error: "Quote already converted" }, { status: 400 })
  }

  if (!quote.customerId) {
    return NextResponse.json(
      { error: "Satış faturası için teklifte müşteri seçilmelidir." },
      { status: 400 }
    )
  }

  const invoiceNo = await generateInvoiceNumber(quote.companyId, "SALES", quote.date)

  const invoice = await prisma.invoice.create({
    data: {
      companyId: quote.companyId,
      invoiceNo,
      type: "SALES",
      invoiceType: "MANUAL",
      customerId: quote.customerId,
      supplierId: quote.supplierId,
      date: quote.date,
      dueDate: quote.validUntil,
      totalAmount: quote.totalAmount,
      vatAmount: quote.vatAmount,
      netAmount: quote.netAmount,
      currency: quote.currency,
      notes: quote.notes,
      status: "DRAFT",
      createdBy: user.id,
      items: {
        create: quote.items.map((item, index) => ({
          productId: item.productId,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountRate: item.discountRate,
          discountAmount: item.discountAmount,
          vatRate: item.vatRate,
          vatAmount: item.vatAmount,
          totalAmount: item.totalAmount,
          order: index,
        })),
      },
    },
    include: { items: true },
  })

  // Stok hareketi: Satış faturası için stok azalt
  for (const item of quote.items) {
    if (!item.productId) continue

    // Stok hareketi oluştur
    await prisma.stockMovement.create({
      data: {
        companyId: quote.companyId,
        productId: item.productId,
        type: "SALE",
        quantity: -item.quantity, // Satış: stok azal
        description: `${invoiceNo} - Satış faturası`,
        reference: invoice.id,
        referenceType: "INVOICE",
        createdBy: user.id,
      },
    })

    // Ürünün stok miktarını güncelle
    await prisma.product.update({
      where: { id: item.productId },
      data: {
        stockQuantity: {
          decrement: item.quantity,
        },
      },
    })
  }

  await prisma.quote.update({
    where: { id: quote.id },
    data: {
      status: "CONVERTED",
      convertedInvoiceId: invoice.id,
    },
  })

  return NextResponse.json(invoice, { status: 201 })
}
