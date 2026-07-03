import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
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
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    const accountId = searchParams.get("accountId")

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

    if (accountId) {
      where.accountId = accountId
    }

    const cashCounts = await prisma.cashCount.findMany({
      where,
      include: {
        account: true,
      },
      orderBy: { countDate: "desc" },
    })

    return NextResponse.json(cashCounts)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching cash counts:", error)
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
      accountId,
      countDate,
      expectedBalance,
      actualBalance,
      notes,
    } = body

    if (!companyId || !accountId || !expectedBalance || actualBalance === undefined) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    const difference = parseFloat(actualBalance) - parseFloat(expectedBalance)

    const cashCount = await prisma.cashCount.create({
      data: {
        companyId,
        accountId,
        countDate: countDate ? new Date(countDate) : new Date(),
        expectedBalance: parseFloat(expectedBalance),
        actualBalance: parseFloat(actualBalance),
        difference,
        notes: notes || null,
        createdBy: user.id,
      },
      include: {
        account: true,
      },
    })

    return NextResponse.json(cashCount, { status: 201 })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error creating cash count:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

