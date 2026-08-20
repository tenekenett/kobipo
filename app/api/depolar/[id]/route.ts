import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = 'force-dynamic'

export const GET = withApiErrors(async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: resolvedParams.id },
      include: {
        stocks: {
          include: {
            product: true,
          },
        },
      },
    })

    if (!warehouse) {
      return NextResponse.json(
        { error: "Warehouse not found" },
        { status: 404 }
      )
    }

    await ensureCompanyAccess(warehouse.companyId)

    return NextResponse.json(warehouse)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error fetching warehouse:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
})

export const PUT = withApiErrors(async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: resolvedParams.id },
    })

    if (!warehouse) {
      return NextResponse.json(
        { error: "Warehouse not found" },
        { status: 404 }
      )
    }

    await ensureCompanyWrite(warehouse.companyId)

    const body = await request.json()
    const { code, name, address, city, isActive } = body

    const updated = await prisma.warehouse.update({
      where: { id: resolvedParams.id },
      data: {
        code: code !== undefined ? code : warehouse.code,
        name: name !== undefined ? name : warehouse.name,
        address: address !== undefined ? address : warehouse.address,
        city: city !== undefined ? city : warehouse.city,
        isActive: isActive !== undefined ? isActive : warehouse.isActive,
      },
    })

    return NextResponse.json(updated)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error updating warehouse:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
})

export const DELETE = withApiErrors(async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: resolvedParams.id },
    })

    if (!warehouse) {
      return NextResponse.json(
        { error: "Warehouse not found" },
        { status: 404 }
      )
    }

    await ensureCompanyWrite(warehouse.companyId)

    // Depoyu pasif yap (silme)
    await prisma.warehouse.update({
      where: { id: resolvedParams.id },
      data: { isActive: false },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error deleting warehouse:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
})

