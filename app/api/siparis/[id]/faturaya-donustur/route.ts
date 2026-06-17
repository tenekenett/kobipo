import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { generateInvoiceNumber } from "@/lib/utils/invoice-number"
import { adjustWarehouseStock } from "@/lib/stock/warehouse"

export const dynamic = "force-dynamic"

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true },
  })
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 })

  await ensureCompanyAccess(order.companyId)

  if (order.convertedInvoiceId) {
    return NextResponse.json({ error: "Sipariş zaten faturaya dönüştürülmüş" }, { status: 400 })
  }
  if (order.status === "CANCELLED") {
    return NextResponse.json({ error: "İptal edilmiş sipariş faturaya dönüştürülemez" }, { status: 400 })
  }

  const isSales = order.type === "SALES"
  if (isSales && !order.customerId) {
    return NextResponse.json({ error: "Satış faturası için siparişte müşteri olmalı" }, { status: 400 })
  }
  if (!isSales && !order.supplierId) {
    return NextResponse.json({ error: "Alış faturası için siparişte tedarikçi olmalı" }, { status: 400 })
  }

  const buildInvoice = (invoiceNo: string) =>
    prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        companyId: order.companyId,
        invoiceNo,
        type: isSales ? "SALES" : "PURCHASE",
        invoiceType: "MANUAL",
        customerId: order.customerId,
        supplierId: order.supplierId,
        date: order.date,
        dueDate: order.deliveryDate,
        totalAmount: order.totalAmount,
        vatAmount: order.vatAmount,
        netAmount: order.netAmount,
        currency: order.currency,
        notes: order.notes,
        status: "DRAFT",
        createdBy: user.id,
        items: {
          create: order.items.map((item, index) => ({
            ...(item.productId ? { product: { connect: { id: item.productId } } } : {}),
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

    // Stok hareketi: depo bazlı (varsayılan depo). Satış azaltır, alış artırır.
    for (const item of order.items) {
      if (!item.productId) continue
      await adjustWarehouseStock(tx, {
        companyId: order.companyId,
        productId: item.productId,
        delta: isSales ? -Number(item.quantity) : Number(item.quantity),
        type: isSales ? "OUT" : "IN",
        unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
        description: `${invoiceNo} - ${isSales ? "Satış" : "Alış"} faturası (siparişten)`,
        reference: invoice.id,
        createdBy: user.id,
      })
    }

    await tx.order.update({
      where: { id: order.id },
      data: { status: "CONVERTED", convertedInvoiceId: invoice.id },
    })

    return invoice
    })

  // Fatura no üretimi transaction dışında olduğundan eşzamanlı isteklerde
  // mükerrer numara (P2002) oluşabilir; çakışmada yeni numara üretip yeniden dene.
  const invoiceType = isSales ? "SALES" : "PURCHASE"
  let result
  for (let attempt = 0; attempt < 5; attempt++) {
    const invoiceNo = await generateInvoiceNumber(order.companyId, invoiceType, order.date)
    try {
      result = await buildInvoice(invoiceNo)
      break
    } catch (error: any) {
      const isDuplicate = error?.code === "P2002"
      if (!isDuplicate || attempt === 4) {
        if (isDuplicate) {
          return NextResponse.json(
            { error: "Fatura numarası üretilemedi, lütfen tekrar deneyin" },
            { status: 409 },
          )
        }
        throw error
      }
    }
  }

  return NextResponse.json(result, { status: 201 })
}
