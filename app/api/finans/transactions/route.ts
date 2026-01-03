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

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get("companyId")
    const accountId = searchParams.get("accountId")
    const type = searchParams.get("type")
    const startDate = searchParams.get("startDate")
    const endDate = searchParams.get("endDate")

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

    if (type) {
      where.type = type
    }

    if (startDate || endDate) {
      where.date = {}
      if (startDate) {
        where.date.gte = new Date(startDate)
      }
      if (endDate) {
        where.date.lte = new Date(endDate)
      }
    }

    const transactions = await prisma.transaction.findMany({
      where,
      include: {
        account: true,
        customer: true,
        supplier: true,
      },
      orderBy: { date: "desc" },
    })

    return NextResponse.json(transactions)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching transactions:", error)
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
      accountId,
      type,
      amount,
      currency,
      description,
      date,
      reference,
      customerId,
      supplierId,
    } = body

    if (!companyId || !accountId || !type || !amount) {
      return NextResponse.json(
        { error: "companyId, accountId, type, and amount are required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    const account = await prisma.financialAccount.findUnique({
      where: { id: accountId },
    })

    if (!account || account.companyId !== companyId) {
      return NextResponse.json(
        { error: "Account not found" },
        { status: 404 }
      )
    }

    // Create transaction
    const transaction = await prisma.transaction.create({
      data: {
        companyId,
        accountId,
        type,
        amount: parseFloat(amount),
        currency: currency || "TRY",
        description,
        date: date ? new Date(date) : new Date(),
        reference,
        customerId,
        supplierId,
        createdBy: user.id,
      },
    })

    // Update account balance
    let newBalance = Number(account.balance)
    if (type === "INCOME") {
      newBalance += parseFloat(amount)
    } else if (type === "EXPENSE") {
      newBalance -= parseFloat(amount)
    }

    await prisma.financialAccount.update({
      where: { id: accountId },
      data: {
        balance: newBalance,
      },
    })

    return NextResponse.json(transaction, { status: 201 })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error creating transaction:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

