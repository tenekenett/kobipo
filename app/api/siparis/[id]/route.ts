import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

function calculateTotals(items: any[]) {
  let netAmount = 0
  let vatAmount = 0
  let totalAmount = 0

  const normalized = items
    .filter((item) => item?.description && String(item.description).trim())
    .map((item) => {
      const quantity = Number(item.quantity || 0)
      const unitPrice = Number(item.unitPrice || 0)
      const discountRate = Number(item.discountRate || 0)
      const vatRate = Number(item.vatRate || 0)

      const gross = quantity * unitPrice
      const discountAmount = gross * (discountRate / 100)
      const net = gross - discountAmount
      const vat = net * (vatRate / 100)
      const total = net + vat

      netAmount += net
      vatAmount += vat
      totalAmount += total

      return {
        productId: item.productId || null,
        description: String(item.description).trim(),
        quantity,
        unitPrice,
        discountRate,
        discountAmount,
        vatRate,
        vatAmount: vat,
        totalAmount: total,
      }
    })

  return { normalized, netAmount, vatAmount, totalAmount }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      customer: true,
      supplier: true,
      items: { include: { product: true }, orderBy: { order: "asc" } },
    },
  })
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 })

  await ensureCompanyAccess(order.companyId)
  return NextResponse.json(order)
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const existing = await prisma.order.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Order not found" }, { status: 404 })
  await ensureCompanyWrite(existing.companyId)

  if (existing.status === "CONVERTED" || existing.convertedInvoiceId) {
    return NextResponse.json(
      { error: "Faturaya dönüştürülmüş sipariş düzenlenemez" },
      { status: 400 }
    )
  }

  const body = await request.json()
  const { customerId, supplierId, date, deliveryDate, currency, notes, status, items } = body

  const data: any = {}
  if (date !== undefined) data.date = date ? new Date(date) : existing.date
  if (deliveryDate !== undefined) data.deliveryDate = deliveryDate ? new Date(deliveryDate) : null
  if (currency !== undefined) data.currency = currency || "TRY"
  if (notes !== undefined) data.notes = notes || null
  if (status !== undefined) data.status = status
  if (existing.type === "SALES" && customerId !== undefined) data.customerId = customerId || null
  if (existing.type === "PURCHASE" && supplierId !== undefined) data.supplierId = supplierId || null

  // Kalemler gönderildiyse tümünü yeniden yaz ve toplamları hesapla
  if (Array.isArray(items)) {
    const { normalized, netAmount, vatAmount, totalAmount } = calculateTotals(items)
    if (!normalized.length) {
      return NextResponse.json({ error: "En az bir geçerli kalem gerekli" }, { status: 400 })
    }
    data.netAmount = netAmount
    data.vatAmount = vatAmount
    data.totalAmount = totalAmount
    data.items = {
      deleteMany: {},
      create: normalized.map((item, index) => ({ ...item, order: index })),
    }
  }

  const order = await prisma.order.update({
    where: { id },
    data,
    include: {
      customer: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true } },
      items: { orderBy: { order: "asc" } },
    },
  })

  return NextResponse.json(order)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const existing = await prisma.order.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Order not found" }, { status: 404 })
  await ensureCompanyWrite(existing.companyId)

  if (existing.status === "CONVERTED" || existing.convertedInvoiceId) {
    return NextResponse.json(
      { error: "Faturaya dönüştürülmüş sipariş silinemez" },
      { status: 400 }
    )
  }

  await prisma.order.delete({ where: { id } })
  return NextResponse.json({ message: "Order deleted" })
}
