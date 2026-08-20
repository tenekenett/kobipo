import { accessDeniedResponse, isAccessDeniedError, withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

function normalizeType(value: unknown): "SALES" | "PURCHASE" {
  return String(value || "").toUpperCase() === "PURCHASE" ? "PURCHASE" : "SALES"
}

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

async function generateOrderNumber(companyId: string, type: "SALES" | "PURCHASE") {
  const year = new Date().getFullYear()
  const prefix = `${type === "PURCHASE" ? "ASP" : "SIP"}-${year}-`
  // En büyük mevcut numarayı bul ve artır. `count + 1` KULLANMA: aradaki bir
  // sipariş silinince sayı düşer ve var olan bir numarayla çakışır (P2002).
  // Numara 6 hane sıfır dolgulu olduğundan sözlüksel sıralama = sayısal sıralama.
  const last = await prisma.order.findFirst({
    where: { companyId, type, orderNo: { startsWith: prefix } },
    orderBy: { orderNo: "desc" },
    select: { orderNo: true },
  })
  let next = 1
  if (last?.orderNo) {
    const parsed = parseInt(last.orderNo.slice(prefix.length), 10)
    if (!Number.isNaN(parsed)) next = parsed + 1
  }
  return `${prefix}${String(next).padStart(6, "0")}`
}

export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const companyId = await resolveCompanyId(searchParams.get("companyId"))
  const type = searchParams.get("type")
  const status = searchParams.get("status")
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyAccess(companyId)

  const where: any = { companyId }
  if (type) where.type = normalizeType(type)
  if (status) where.status = status

  const orders = await prisma.order.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json(orders)
})

export const POST = withApiErrors(async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  body.companyId = await resolveCompanyId(body.companyId)
  const {
    companyId,
    orderNo,
    type,
    customerId,
    supplierId,
    date,
    deliveryDate,
    currency,
    notes,
    items = [],
  } = body

  if (!companyId || !items?.length) {
    return NextResponse.json({ error: "companyId and items are required" }, { status: 400 })
  }
  const orderType = normalizeType(type)
  if (orderType === "SALES" && !customerId) {
    return NextResponse.json({ error: "Satış siparişi için müşteri seçilmelidir" }, { status: 400 })
  }
  if (orderType === "PURCHASE" && !supplierId) {
    return NextResponse.json({ error: "Alış siparişi için tedarikçi seçilmelidir" }, { status: 400 })
  }
  await ensureCompanyWrite(companyId)

  const { normalized, netAmount, vatAmount, totalAmount } = calculateTotals(items)
  if (!normalized.length) {
    return NextResponse.json({ error: "En az bir geçerli kalem gerekli" }, { status: 400 })
  }

  const buildData = (finalOrderNo: string) => ({
    companyId,
    orderNo: finalOrderNo,
    type: orderType,
    customerId: orderType === "SALES" ? customerId : null,
    supplierId: orderType === "PURCHASE" ? supplierId : null,
    date: date ? new Date(date) : new Date(),
    deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
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
  })

  // Numara üretimiyle create arasında eşzamanlı başka bir sipariş araya girerse
  // (companyId, orderNo) tekil kısıtı patlar (P2002). Otomatik numarada birkaç kez
  // yeniden üretip dene; kullanıcı kendi numarasını verdiyse tekrar deneme.
  const maxAttempts = orderNo ? 1 : 5
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const finalOrderNo = orderNo || (await generateOrderNumber(companyId, orderType))
    try {
      const order = await prisma.order.create({
        data: buildData(finalOrderNo),
        include: {
          customer: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          items: true,
        },
      })
      return NextResponse.json(order, { status: 201 })
    } catch (error: any) {
      // Kapı reddi (modül/sayfa/rol) 403 döner; buradaki diğer dallar veri hatası içindir.
      if (isAccessDeniedError(error)) return accessDeniedResponse(error)
      if (error?.code === "P2002" && attempt < maxAttempts - 1 && !orderNo) continue
      if (error?.code === "P2002") {
        return NextResponse.json(
          { error: "Bu sipariş numarası zaten kullanımda. Lütfen tekrar deneyin." },
          { status: 409 },
        )
      }
      console.error("Error creating order:", error)
      return NextResponse.json({ error: "Sipariş oluşturulamadı" }, { status: 500 })
    }
  }

  return NextResponse.json({ error: "Sipariş numarası üretilemedi" }, { status: 409 })
})
