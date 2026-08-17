import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
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

      const note = item.note != null ? String(item.note).trim() : ""

      return {
        productId: item.productId || null,
        description: String(item.description).trim(),
        note: note || null,
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
  // En büyük mevcut numarayı bul ve artır. `count + 1` KULLANMA: aradaki bir
  // teklif silinince sayı düşer ve var olan bir numarayla çakışır (P2002).
  // Numara 6 hane sıfır dolgulu olduğundan sözlüksel sıralama = sayısal sıralama.
  const last = await prisma.quote.findFirst({
    where: { companyId, quoteNo: { startsWith: prefix } },
    orderBy: { quoteNo: "desc" },
    select: { quoteNo: true },
  })
  let next = 1
  if (last?.quoteNo) {
    const parsed = parseInt(last.quoteNo.slice(prefix.length), 10)
    if (!Number.isNaN(parsed)) next = parsed + 1
  }
  return `${prefix}${String(next).padStart(6, "0")}`
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const companyId = await resolveCompanyId(searchParams.get("companyId"))
  const status = searchParams.get("status")
  // party: "customer" → satış teklifleri, "supplier" → satın alma teklifleri.
  // Quote modeli her ikisini paylaşır; filtre yoksa (eski davranış) tümü döner.
  const party = searchParams.get("party")
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyAccess(companyId)

  const where: any = { companyId }
  if (status) where.status = status
  // Satın alma teklifi = tedarikçisi olan; satış teklifi = tedarikçisi olmayan
  // (müşterisiz taslak satış teklifleri de satış listesinde kalsın diye böyle).
  if (party === "supplier") where.supplierId = { not: null }
  else if (party === "customer") where.supplierId = null

  const quotes = await prisma.quote.findMany({
    where,
    include: {
      customer: true,
      supplier: true,
      items: { include: { product: true }, orderBy: { order: "asc" } },
      _count: { select: { items: true } },
    },
    // Tarih (belge günü) çoğunlukla aynı gün olduğundan tek başına sıralama
    // aynı-gün kayıtlarını belirsiz bırakır; ikincil anahtar createdAt (saat dahil)
    // ile en yeniden en eskiye kesinleştir.
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  })
  return NextResponse.json(quotes)
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  body.companyId = await resolveCompanyId(body.companyId)
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
  await ensureCompanyWrite(companyId)

  const { normalized, netAmount, vatAmount, totalAmount } = calculateTotals(items)
  if (!normalized.length) {
    return NextResponse.json({ error: "At least one valid item is required" }, { status: 400 })
  }

  const buildData = (finalQuoteNo: string) => ({
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
  })

  // Numara üretimiyle create arasında eşzamanlı başka bir teklif araya girerse
  // (companyId, quoteNo) tekil kısıtı patlar (P2002). Otomatik numarada birkaç kez
  // yeniden üretip dene; kullanıcı kendi numarasını verdiyse tekrar deneme.
  const maxAttempts = quoteNo ? 1 : 5
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const finalQuoteNo = quoteNo || (await generateQuoteNumber(companyId))
    try {
      const quote = await prisma.quote.create({
        data: buildData(finalQuoteNo),
        include: { customer: true, supplier: true, items: true },
      })
      return NextResponse.json(quote, { status: 201 })
    } catch (error: any) {
      const isDup =
        error?.code === "P2002" && attempt < maxAttempts - 1 && !quoteNo
      if (isDup) continue
      if (error?.code === "P2002") {
        return NextResponse.json(
          { error: "Bu teklif numarası zaten kullanımda. Lütfen tekrar deneyin." },
          { status: 409 },
        )
      }
      console.error("Error creating quote:", error)
      return NextResponse.json({ error: "Teklif oluşturulamadı" }, { status: 500 })
    }
  }

  return NextResponse.json({ error: "Teklif numarası üretilemedi" }, { status: 409 })
}
