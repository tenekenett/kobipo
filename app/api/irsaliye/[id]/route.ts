import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"

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
  await ensureCompanyAccess(existing.companyId)

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
  await ensureCompanyAccess(existing.companyId)

  await prisma.waybill.delete({ where: { id } })
  return NextResponse.json({ message: "Waybill deleted" })
}
