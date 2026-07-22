import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { adjustWarehouseStock, ensureDefaultWarehouseId, revertStockByReference } from "@/lib/stock/warehouse"

export const dynamic = "force-dynamic"

const VALID_STATUSES = ["DRAFT", "SENT", "DELIVERED", "CANCELLED"]

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const waybill = await prisma.waybill.findUnique({
    where: { id },
    include: {
      customer: true,
      supplier: true,
      invoice: { select: { id: true, invoiceNo: true } },
      items: { include: { product: true }, orderBy: { order: "asc" } },
    },
  })
  if (!waybill) return NextResponse.json({ error: "Waybill not found" }, { status: 404 })

  await ensureCompanyAccess(waybill.companyId)
  return NextResponse.json(waybill)
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const existing = await prisma.waybill.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Waybill not found" }, { status: 404 })
  await ensureCompanyWrite(existing.companyId)

  const body = await request.json()
  const {
    status,
    date,
    deliveryDate,
    carrier,
    vehicleNo,
    driverName,
    departureAddress,
    deliveryAddress,
    notes,
    items,
  } = body

  const data: any = {}
  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: "Geçersiz durum" }, { status: 400 })
    }
    data.status = status
  }
  if (date !== undefined) data.date = date ? new Date(date) : existing.date
  if (deliveryDate !== undefined) data.deliveryDate = deliveryDate ? new Date(deliveryDate) : null
  if (carrier !== undefined) data.carrier = carrier || null
  if (vehicleNo !== undefined) data.vehicleNo = vehicleNo || null
  if (driverName !== undefined) data.driverName = driverName || null
  if (departureAddress !== undefined) data.departureAddress = departureAddress || null
  if (deliveryAddress !== undefined) data.deliveryAddress = deliveryAddress || null
  if (notes !== undefined) data.notes = notes || null

  if (Array.isArray(items)) {
    const normalized = items
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
    if (!normalized.length) {
      return NextResponse.json({ error: "En az bir geçerli kalem gerekli" }, { status: 400 })
    }
    data.items = { deleteMany: {}, create: normalized }
  }

  const waybill = await prisma.waybill.update({
    where: { id },
    data,
    include: {
      customer: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    },
  })

  // Alış irsaliyesi stok girişi: "Teslim alındı" (DELIVERED) olunca kalemler BİR KEZ
  // stoğa girer; bu durumdan çıkınca geri alınır. reference = "waybill:<id>". Böylece
  // faturaya bağlanınca fatura stoğu tekrar İŞLEMEZ (çift stok önlenir). Hizmet ürünleri
  // stok takibi yapmaz → atlanır. stockProcessed bayrağı idempotentliği garanti eder.
  if (existing.type === "PURCHASE" && status !== undefined) {
    const nowDelivered = waybill.status === "DELIVERED"
    const reference = `waybill:${existing.id}`
    try {
      if (nowDelivered && !existing.stockProcessed) {
        const full = await prisma.waybill.findUnique({
          where: { id: existing.id },
          include: { items: true },
        })
        const wItems = full?.items ?? []
        const productIds = Array.from(
          new Set(wItems.map((i) => i.productId).filter((x): x is string => Boolean(x))),
        )
        const serviceIds = new Set(
          productIds.length > 0
            ? (
                await prisma.product.findMany({
                  where: { id: { in: productIds }, isService: true },
                  select: { id: true },
                })
              ).map((p) => p.id)
            : [],
        )
        await prisma.$transaction(async (tx) => {
          const whId = await ensureDefaultWarehouseId(tx, existing.companyId)
          for (const it of wItems) {
            if (!it.productId || serviceIds.has(it.productId)) continue
            const qty = Number(it.quantity) || 0
            if (qty <= 0) continue
            await adjustWarehouseStock(tx, {
              companyId: existing.companyId,
              productId: it.productId,
              warehouseId: whId,
              delta: qty,
              type: "IN",
              description: `${waybill.waybillNo} - Alış irsaliyesi (stok girişi)`,
              reference,
              createdBy: user.id,
            })
          }
          await tx.waybill.update({ where: { id: existing.id }, data: { stockProcessed: true } })
        })
        ;(waybill as { stockProcessed?: boolean }).stockProcessed = true
      } else if (!nowDelivered && existing.stockProcessed) {
        await prisma.$transaction(async (tx) => {
          await revertStockByReference(tx, {
            companyId: existing.companyId,
            reference,
            description: `${waybill.waybillNo} - İrsaliye stok geri alındı`,
            createdBy: user.id,
          })
          await tx.waybill.update({ where: { id: existing.id }, data: { stockProcessed: false } })
        })
        ;(waybill as { stockProcessed?: boolean }).stockProcessed = false
      }
    } catch (stockErr) {
      console.error("[İrsaliye stok işleme hatası]", stockErr)
    }
  }

  return NextResponse.json(waybill)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const existing = await prisma.waybill.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Waybill not found" }, { status: 404 })
  await ensureCompanyWrite(existing.companyId)

  await prisma.waybill.delete({ where: { id } })
  return NextResponse.json({ message: "Waybill deleted" })
}
