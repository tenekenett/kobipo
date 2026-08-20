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

// Aynı önekli mevcut irsaliyelerin en büyük sıra numarasını baz alan, silme
// kaynaklı boşluklara karşı çakışma korumalı numara üretimi.
async function generateWaybillNumber(companyId: string, type: "SALES" | "PURCHASE") {
  const year = new Date().getFullYear()
  const fullPrefix = `${type === "PURCHASE" ? "AIR" : "SIR"}-${year}-`
  const existing = await prisma.waybill.findMany({
    where: { companyId, waybillNo: { startsWith: fullPrefix } },
    select: { waybillNo: true },
  })
  let maxSeq = 0
  const taken = new Set<string>()
  for (const { waybillNo } of existing) {
    taken.add(waybillNo)
    const parsed = parseInt(waybillNo.slice(fullPrefix.length), 10)
    if (Number.isFinite(parsed) && parsed > maxSeq) maxSeq = parsed
  }
  let seq = maxSeq + 1
  let candidate = `${fullPrefix}${String(seq).padStart(6, "0")}`
  while (taken.has(candidate)) {
    seq += 1
    candidate = `${fullPrefix}${String(seq).padStart(6, "0")}`
  }
  return candidate
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
  // withItems=1 → faturaya otomatik kalem doldurma için kalemleri de döndür.
  const withItems = searchParams.get("withItems") === "1"

  const waybills = await prisma.waybill.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true } },
      invoice: { select: { id: true, invoiceNo: true } },
      _count: { select: { items: true } },
      ...(withItems
        ? {
            items: {
              include: {
                product: {
                  select: { id: true, name: true, unit: true, vatRate: true, purchasePrice: true, salePrice: true },
                },
              },
              orderBy: { order: "asc" as const },
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json(waybills)
})

export const POST = withApiErrors(async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  body.companyId = await resolveCompanyId(body.companyId)
  const {
    companyId,
    waybillNo,
    type,
    customerId,
    supplierId,
    invoiceId,
    date,
    deliveryDate,
    carrier,
    vehicleNo,
    driverName,
    departureAddress,
    deliveryAddress,
    notes,
    items = [],
  } = body

  if (!companyId || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "companyId and items are required" }, { status: 400 })
  }
  const waybillType = normalizeType(type)
  if (waybillType === "SALES" && !customerId) {
    return NextResponse.json({ error: "Satış irsaliyesi için müşteri seçilmelidir" }, { status: 400 })
  }
  if (waybillType === "PURCHASE" && !supplierId) {
    return NextResponse.json({ error: "Alış irsaliyesi için tedarikçi seçilmelidir" }, { status: 400 })
  }
  await ensureCompanyWrite(companyId)

  const normalizedItems = items
    .filter((item: any) => item?.description && String(item.description).trim())
    .map((item: any, index: number) => ({
      productId: item.productId || null,
      description: String(item.description).trim(),
      quantity: Number(item.quantity || 0),
      unit: item.unit ? String(item.unit) : null,
      weight: item.weight !== undefined && item.weight !== null && item.weight !== "" ? Number(item.weight) : null,
      notes: item.notes ? String(item.notes) : null,
      order: index,
    }))
  if (!normalizedItems.length) {
    return NextResponse.json({ error: "En az bir geçerli kalem gerekli" }, { status: 400 })
  }

  // Elle girilen no (alışta tedarikçinin kendi irsaliye numarası) öncelikli; boşsa üret.
  const manualWaybillNo = typeof waybillNo === "string" ? waybillNo.trim() : ""
  const finalWaybillNo = manualWaybillNo || (await generateWaybillNumber(companyId, waybillType))

  try {
    const waybill = await prisma.waybill.create({
      data: {
        companyId,
        waybillNo: finalWaybillNo,
        type: waybillType,
        status: "DRAFT",
        customerId: waybillType === "SALES" ? customerId : null,
        supplierId: waybillType === "PURCHASE" ? supplierId : null,
        invoiceId: invoiceId || null,
        date: date ? new Date(date) : new Date(),
        deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
        carrier: carrier || null,
        vehicleNo: vehicleNo || null,
        driverName: driverName || null,
        departureAddress: departureAddress || null,
        deliveryAddress: deliveryAddress || null,
        notes: notes || null,
        createdBy: user.id,
        items: { create: normalizedItems },
      },
      include: {
        customer: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
    })

    return NextResponse.json(waybill, { status: 201 })
  } catch (error: any) {
    // Kapı reddi (modül/sayfa/rol) 403 döner; buradaki diğer dallar veri hatası içindir.
    if (isAccessDeniedError(error)) return accessDeniedResponse(error)
    // Aynı firmada aynı irsaliye no (@@unique([companyId, waybillNo])) — elle giriş
    // açıldığı için artık kullanıcı hatası olarak dönebilir.
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "Bu irsaliye no zaten kayıtlı" }, { status: 409 })
    }
    throw error
  }
})
