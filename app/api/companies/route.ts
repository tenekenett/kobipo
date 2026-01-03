import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userCompanies = await prisma.userCompany.findMany({
      where: {
        userId: user.id,
      },
      include: {
        company: true,
      },
    })

    const companies = userCompanies.map((uc) => uc.company)

    return NextResponse.json(companies)
  } catch (error) {
    console.error("Error fetching companies:", error)
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
    const { name, taxNumber, taxOffice, address, city, phone, email } = body

    if (!name) {
      return NextResponse.json(
        { error: "Firma adı zorunludur" },
        { status: 400 }
      )
    }

    const company = await prisma.company.create({
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

    await prisma.userCompany.create({
      data: {
        userId: user.id,
        companyId: company.id,
        role: "ADMIN",
      },
    })

    return NextResponse.json(company, { status: 201 })
  } catch (error) {
    console.error("Error creating company:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

