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
    const accountId = searchParams.get("accountId")
    const type = searchParams.get("type")
    const customerId = searchParams.get("customerId")
    const supplierId = searchParams.get("supplierId")
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

    if (customerId) {
      where.customerId = customerId
    }

    if (supplierId) {
      where.supplierId = supplierId
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
      select: {
        id: true,
        date: true,
        type: true,
        amount: true,
        currency: true,
        description: true,
        reference: true,
        accountId: true,
        customerId: true,
        supplierId: true,
        account: { select: { id: true, name: true, currency: true } },
        customer: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
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
      transferAccountId,
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
    if (type === "TRANSFER" && !transferAccountId) {
      return NextResponse.json(
        { error: "transferAccountId is required for transfer" },
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
        reference: reference || (type === "TRANSFER" ? `TRANSFER:${transferAccountId}` : undefined),
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
    } else if (type === "TRANSFER") {
      newBalance -= parseFloat(amount)
    }

    await prisma.financialAccount.update({
      where: { id: accountId },
      data: {
        balance: newBalance,
      },
    })

    if (type === "TRANSFER" && transferAccountId) {
      const targetAccount = await prisma.financialAccount.findUnique({
        where: { id: transferAccountId },
      })
      if (!targetAccount || targetAccount.companyId !== companyId) {
        return NextResponse.json({ error: "Transfer account not found" }, { status: 404 })
      }

      await prisma.financialAccount.update({
        where: { id: transferAccountId },
        data: { balance: Number(targetAccount.balance) + parseFloat(amount) },
      })

      await prisma.transaction.create({
        data: {
          companyId,
          accountId: transferAccountId,
          type: "INCOME",
          amount: parseFloat(amount),
          currency: currency || "TRY",
          description: description || "Hesaplar arası virman (giriş)",
          date: date ? new Date(date) : new Date(),
          reference: `TRANSFER:${accountId}`,
          createdBy: user.id,
        },
      })
    }

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

