import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"


export const dynamic = 'force-dynamic'
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    await ensureCompanyAccess(resolvedParams.id)

    const company = await prisma.company.findUnique({
      where: { id: resolvedParams.id },
      select: {
        id: true,
        name: true,
        taxNumber: true,
        taxOffice: true,
        address: true,
        city: true,
        country: true,
        phone: true,
        email: true,
        website: true,
        isEDonusumEnabled: true,
        invoiceSeriesPrefix: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    const userCompany = await ensureCompanyAccess(resolvedParams.id)

    const body = await request.json()
    const { name, taxNumber, taxOffice, address, city, phone, email, website, isEDonusumEnabled, invoiceSeriesPrefix } = body

    const company = await prisma.company.update({
      where: { id: resolvedParams.id },
      data: {
        name,
        taxNumber,
        taxOffice,
        address,
        city,
        phone,
        email,
        website,
        isEDonusumEnabled: isEDonusumEnabled !== undefined ? Boolean(isEDonusumEnabled) : undefined,
        invoiceSeriesPrefix: invoiceSeriesPrefix || null,
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

