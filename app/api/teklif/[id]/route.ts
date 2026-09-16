import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { resolveSlugId } from "@/lib/slug-resolve"
import { assertOwnedByCompany } from "@/lib/company/owned"
import { buildQuoteRecord, parseGlobalDiscount } from "@/lib/teklif/quote-record"
import { globalDiscountFromRecord } from "@/lib/teklif/quote-totals"

export const dynamic = "force-dynamic"

export const GET = withApiErrors(async function GET(
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
})

export const PUT = withApiErrors(async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: rawId } = await params
  const id = await resolveSlugId("quote", rawId, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))
  const existing = await prisma.quote.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Quote not found" }, { status: 404 })

  await ensureCompanyWrite(existing.companyId)

  if (existing.status === "CONVERTED") {
    return NextResponse.json({ error: "Faturalanmış teklif düzenlenemez." }, { status: 400 })
  }

  const body = await request.json()
  const { customerId, supplierId, date, validUntil, currency, notes, status, items } = body
  const globalDiscount = parseGlobalDiscount(body.globalDiscount)

  let payload: any = {
    customerId: customerId !== undefined ? customerId : existing.customerId,
    supplierId: supplierId !== undefined ? supplierId : existing.supplierId,
    date: date ? new Date(date) : existing.date,
    validUntil: validUntil !== undefined ? (validUntil ? new Date(validUntil) : null) : existing.validUntil,
    currency: currency || existing.currency,
    notes: notes !== undefined ? notes : existing.notes,
    status: status || existing.status,
  }

  // Tutarlar kalem ya da genel iskonto değiştiğinde yeniden kurulur. Yalnız
  // durum değiştiren istek (liste ekranındaki durum seçici) ikisine de dokunmaz.
  if (items?.length || globalDiscount !== undefined) {
    // Gövdede genel iskonto yoksa kayıttaki korunur: kalem düzenleyen bir istemci
    // alanı göndermeyi unutursa iskonto sessizce silinmesin.
    const discount = globalDiscount !== undefined ? globalDiscount : globalDiscountFromRecord(existing)
    // Kalem gönderilmediyse (yalnız iskonto değişti) mevcut kalemler üzerinden hesaplanır.
    const sourceItems = items?.length
      ? items
      : (
          await prisma.quoteItem.findMany({ where: { quoteId: id }, orderBy: { order: "asc" } })
        ).map((it) => ({
          ...it,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
          vatRate: Number(it.vatRate),
          discountRate: it.discountRate != null ? Number(it.discountRate) : null,
          discountAmount: it.discountAmount != null ? Number(it.discountAmount) : null,
        }))
    const record = buildQuoteRecord(sourceItems, discount)
    payload = {
      ...payload,
      netAmount: record.netAmount,
      vatAmount: record.vatAmount,
      totalAmount: record.totalAmount,
      globalDiscountRate: record.globalDiscountRate,
      globalDiscountAmount: record.globalDiscountAmount,
    }
    if (items?.length) {
      payload.items = { create: record.normalized.map((item, index) => ({ ...item, order: index })) }
    }
  }

  // Sahiplik: cari ve kalemlerin ürünleri bu firmanın olmalı.
  await assertOwnedByCompany(existing.companyId, {
    customer: payload.customerId,
    supplier: payload.supplierId,
    product: payload.items ? (payload.items.create as Array<{ productId: string | null }>).map((i) => i.productId) : [],
  })

  // Eski kalemler sahiplik kapısından SONRA ve güncellemeyle AYNI sorguda silinir
  // (iç içe deleteMany + create). Öncesinde kapıdan önce siliniyordu: kapı
  // reddederse teklif kalemsiz kalıyordu.
  if (payload.items) payload.items = { deleteMany: {}, ...payload.items }

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
})

export const DELETE = withApiErrors(async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: rawId } = await params
  const id = await resolveSlugId("quote", rawId, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))
  const existing = await prisma.quote.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Quote not found" }, { status: 404 })

  await ensureCompanyWrite(existing.companyId)
  await prisma.quote.delete({ where: { id } })
  return NextResponse.json({ success: true })
})
