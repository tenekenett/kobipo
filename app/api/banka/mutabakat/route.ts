import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"

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

    const statements = await prisma.bankStatement.findMany({
      where,
      include: {
        account: true,
        items: {
          orderBy: { transactionDate: "asc" },
        },
      },
      orderBy: { statementDate: "desc" },
    })

    return NextResponse.json(statements)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching bank statements:", error)
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
      statementDate,
      openingBalance,
      closingBalance,
      items,
      notes,
    } = body

    if (!companyId || !accountId || !statementDate || !items || items.length === 0) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    await ensureCompanyWrite(companyId)

    const statement = await prisma.bankStatement.create({
      data: {
        companyId,
        accountId,
        statementDate: new Date(statementDate),
        openingBalance: parseFloat(openingBalance),
        closingBalance: parseFloat(closingBalance),
        notes: notes || null,
        createdBy: user.id,
        items: {
          create: items.map((item: any, index: number) => ({
            transactionDate: new Date(item.transactionDate),
            valueDate: item.valueDate ? new Date(item.valueDate) : null,
            description: item.description,
            amount: parseFloat(item.amount),
            balance: item.balance ? parseFloat(item.balance) : null,
            reference: item.reference || null,
            notes: item.notes || null,
            order: index,
          })),
        },
      },
      include: {
        account: true,
        items: true,
      },
    })

    return NextResponse.json(statement, { status: 201 })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error creating bank statement:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

