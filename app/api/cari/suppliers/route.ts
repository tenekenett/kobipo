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
    const search = searchParams.get("search")

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

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
        { taxNumber: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ]
    }

    const suppliers = await prisma.supplier.findMany({
      where,
      orderBy: { name: "asc" },
    })

    return NextResponse.json(suppliers)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching suppliers:", error)
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
      code,
      name,
      taxNumber,
      taxOffice,
      address,
      city,
      phone,
      email,
      contactPerson,
    } = body

    if (!companyId || !name) {
      return NextResponse.json(
        { error: "companyId and name are required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    const supplier = await prisma.supplier.create({
      data: {
        companyId,
        code,
        name,
        taxNumber,
        taxOffice,
        address,
        city,
        phone,
        email,
        contactPerson,
      },
    })

    return NextResponse.json(supplier, { status: 201 })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error creating supplier:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

