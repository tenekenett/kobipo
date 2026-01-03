import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get("companyId")
    const type = searchParams.get("type")
    const status = searchParams.get("status")

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    const where: any = {
      companyId,
    }

    if (type) {
      where.type = type
    }

    if (status) {
      where.status = status
    }

    const waybills = await prisma.waybill.findMany({
      where,
      include: {
        customer: true,
        supplier: true,
        invoice: true,
        items: {
          include: {
            product: true,
          },
        },
      },
      orderBy: { date: "desc" },
    })

    return NextResponse.json(waybills)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching waybills:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
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
      items,
      notes,
    } = body

    if (!companyId || !waybillNo || !type || !items || items.length === 0) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    const waybill = await prisma.waybill.create({
      data: {
        companyId,
        waybillNo,
        type,
        customerId: customerId || null,
        supplierId: supplierId || null,
        invoiceId: invoiceId || null,
        date: new Date(date),
        deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
        carrier: carrier || null,
        vehicleNo: vehicleNo || null,
        driverName: driverName || null,
        departureAddress: departureAddress || null,
        deliveryAddress: deliveryAddress || null,
        notes: notes || null,
        status: "DRAFT",
        createdBy: user.id,
        items: {
          create: items.map((item: any, index: number) => ({
            productId: item.productId || null,
            description: item.description,
            quantity: parseFloat(item.quantity),
            unit: item.unit || null,
            weight: item.weight ? parseFloat(item.weight) : null,
            notes: item.notes || null,
            order: index,
          })),
        },
      },
      include: {
        customer: true,
        supplier: true,
        invoice: true,
        items: {
          include: {
            product: true,
          },
        },
      },
    })

    return NextResponse.json(waybill, { status: 201 })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error creating waybill:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

