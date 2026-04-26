import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"

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

async function generateQuoteNumber(companyId: string) {
  const year = new Date().getFullYear()
  const prefix = `TKF-${year}-`
  const count = await prisma.quote.count({
    where: { companyId, quoteNo: { startsWith: prefix } },
  })
  return `${prefix}${String(count + 1).padStart(6, "0")}`
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const companyId = searchParams.get("companyId")
  const status = searchParams.get("status")
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyAccess(companyId)

  const where: any = { companyId }
  if (status) where.status = status

  const quotes = await prisma.quote.findMany({
    where,
    include: {
      customer: true,
      supplier: true,
      items: { include: { product: true }, orderBy: { order: "asc" } },
    },
    orderBy: { date: "desc" },
  })
  return NextResponse.json(quotes)
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const {
    companyId,
    quoteNo,
    customerId,
    supplierId,
    date,
    validUntil,
    currency,
    notes,
    items = [],
  } = body

  if (!companyId || !items?.length) {
    return NextResponse.json({ error: "companyId and items are required" }, { status: 400 })
  }
  await ensureCompanyAccess(companyId)

  const { normalized, netAmount, vatAmount, totalAmount } = calculateTotals(items)
  if (!normalized.length) {
    return NextResponse.json({ error: "At least one valid item is required" }, { status: 400 })
  }

  const finalQuoteNo = quoteNo || (await generateQuoteNumber(companyId))

  const quote = await prisma.quote.create({
    data: {
      companyId,
      quoteNo: finalQuoteNo,
      customerId: customerId || null,
      supplierId: supplierId || null,
      date: date ? new Date(date) : new Date(),
      validUntil: validUntil ? new Date(validUntil) : null,
      currency: currency || "TRY",
      notes: notes || null,
      netAmount,
      vatAmount,
      totalAmount,
      createdBy: user.id,
      items: {
        create: normalized.map((item, index) => ({
          ...item,
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

  return NextResponse.json(quote, { status: 201 })
}
