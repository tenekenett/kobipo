import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = 'force-dynamic'


export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    const type = searchParams.get("type")

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    const where: any = {
      companyId,
      isActive: true,
    }

    if (type) {
      where.type = type
    }

    const accounts = await prisma.financialAccount.findMany({
      where,
      orderBy: { name: "asc" },
    })

    return NextResponse.json(accounts)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error fetching accounts:", error)
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
    body.companyId = await resolveCompanyId(body.companyId)
    const {
      companyId,
      code,
      name,
      type,
      bankName,
      accountNumber,
      iban,
      currency,
      openingBalance,
    } = body

    if (!companyId || !name || !type) {
      return NextResponse.json(
        { error: "companyId, name, and type are required" },
        { status: 400 }
      )
    }

    await ensureCompanyWrite(companyId)

    const parsedOpeningBalance =
      openingBalance != null && openingBalance !== "" && !Number.isNaN(parseFloat(openingBalance))
        ? parseFloat(openingBalance)
        : 0

    const account = await prisma.financialAccount.create({
      data: {
        companyId,
        code,
        name,
        type,
        bankName,
        accountNumber,
        iban,
        currency: currency || "TRY",
        balance: parsedOpeningBalance,
      },
    })

    return NextResponse.json(account, { status: 201 })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error creating account:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

