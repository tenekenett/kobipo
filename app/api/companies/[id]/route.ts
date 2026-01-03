import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"


export const dynamic = 'force-dynamic'
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    await ensureCompanyAccess(params.id)

    const company = await prisma.company.findUnique({
      where: { id: params.id },
    })

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 })
    }

    return NextResponse.json(company)
  } catch (error: any) {
    if (error.message === "Unauthorized" || error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching company:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userCompany = await ensureCompanyAccess(params.id)

    if (userCompany.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Only admins can update company" },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { name, taxNumber, taxOffice, address, city, phone, email } = body

    const company = await prisma.company.update({
      where: { id: params.id },
      data: {
        name,
        taxNumber,
        taxOffice,
        address,
        city,
        phone,
        email,
      },
    })

    return NextResponse.json(company)
  } catch (error: any) {
    if (error.message === "Unauthorized" || error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error updating company:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

