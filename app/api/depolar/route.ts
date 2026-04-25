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

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    let warehouses = await prisma.warehouse.findMany({
      where: {
        companyId,
        isActive: true,
      },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    })

    if (warehouses.length === 0) {
      await prisma.warehouse.create({
        data: {
          companyId,
          code: "ANA",
          name: "Ana Depo",
          isDefault: true,
        },
      })

      warehouses = await prisma.warehouse.findMany({
        where: {
          companyId,
          isActive: true,
        },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      })
    }

    return NextResponse.json(warehouses)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching warehouses:", error)
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
    const { companyId, code, name, address, city, isDefault } = body

    if (!companyId || !name) {
      return NextResponse.json(
        { error: "companyId and name are required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    const warehouse = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.warehouse.updateMany({
          where: { companyId },
          data: { isDefault: false },
        })
      }

      return tx.warehouse.create({
        data: {
          companyId,
          code: code || null,
          name,
          address: address || null,
          city: city || null,
          isDefault: Boolean(isDefault),
        },
      })
    })

    return NextResponse.json(warehouse, { status: 201 })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error creating warehouse:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

