import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { resolveSlugId } from "@/lib/slug-resolve"

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
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: rawId } = await params
  const id = await resolveSlugId("quote", rawId, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))
  const quote = await prisma.quote.findUnique({
    where: { id },
    include: {
      customer: true,
      supplier: true,
      items: { include: { product: true }, orderBy: { order: "asc" } },
    },
  })
  if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 })

  await ensureCompanyAccess(quote.companyId)
  return NextResponse.json(quote)
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: rawId } = await params
  const id = await resolveSlugId("quote", rawId, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))
  const existing = await prisma.quote.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Quote not found" }, { status: 404 })

  await ensureCompanyAccess(existing.companyId)

  if (existing.status === "CONVERTED") {
    return NextResponse.json({ error: "Faturalanmış teklif düzenlenemez." }, { status: 400 })
  }

  const body = await request.json()
  const { customerId, supplierId, date, validUntil, currency, notes, status, items } = body

  let payload: any = {
    customerId: customerId !== undefined ? customerId : existing.customerId,
    supplierId: supplierId !== undefined ? supplierId : existing.supplierId,
    date: date ? new Date(date) : existing.date,
    validUntil: validUntil !== undefined ? (validUntil ? new Date(validUntil) : null) : existing.validUntil,
    currency: currency || existing.currency,
    notes: notes !== undefined ? notes : existing.notes,
    status: status || existing.status,
  }

  if (items?.length) {
    const { normalized, netAmount, vatAmount, totalAmount } = calculateTotals(items)
    payload = { ...payload, netAmount, vatAmount, totalAmount }
    await prisma.quoteItem.deleteMany({ where: { quoteId: id } })
    payload.items = { create: normalized.map((item, index) => ({ ...item, order: index })) }
  }

  const updated = await prisma.quote.update({
    where: { id },
    data: payload,
    include: {
      customer: true,
      supplier: true,
      items: { include: { product: true }, orderBy: { order: "asc" } },
    },
  })
  return NextResponse.json(updated)
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: rawId } = await params
  const id = await resolveSlugId("quote", rawId, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))
  const existing = await prisma.quote.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Quote not found" }, { status: 404 })

  await ensureCompanyAccess(existing.companyId)
  await prisma.quote.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
