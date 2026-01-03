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

    const invoices = await prisma.invoice.findMany({
      where,
      include: {
        customer: true,
        supplier: true,
        items: true,
      },
      orderBy: { date: "desc" },
    })

    const transactions = await prisma.transaction.findMany({
      where: {
        companyId,
        ...(customerId && { customerId }),
        ...(supplierId && { supplierId }),
        ...(startDate || endDate
          ? {
              date: {
                ...(startDate && { gte: new Date(startDate) }),
                ...(endDate && { lte: new Date(endDate) }),
              },
            }
          : {}),
      },
      include: {
        account: true,
        customer: true,
        supplier: true,
      },
      orderBy: { date: "desc" },
    })

    // Combine and sort by date
    const entries = [
      ...invoices.map((inv) => ({
        type: "INVOICE",
        id: inv.id,
        date: inv.date,
        description: `Fatura ${inv.invoiceNo}`,
        debit: inv.type === "SALES" ? Number(inv.totalAmount) : 0,
        credit: inv.type === "PURCHASE" ? Number(inv.totalAmount) : 0,
        balance: 0,
        reference: inv.invoiceNo,
        data: inv,
      })),
      ...transactions.map((trx) => ({
        type: "TRANSACTION",
        id: trx.id,
        date: trx.date,
        description: trx.description || `${trx.type} - ${trx.account.name}`,
        debit: trx.type === "INCOME" ? Number(trx.amount) : 0,
        credit: trx.type === "EXPENSE" ? Number(trx.amount) : 0,
        balance: 0,
        reference: trx.reference,
        data: trx,
      })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    // Calculate running balance
    let runningBalance = 0
    entries.forEach((entry) => {
      runningBalance += entry.debit - entry.credit
      entry.balance = runningBalance
    })

    return NextResponse.json({
      entries,
      totalDebit: entries.reduce((sum, e) => sum + e.debit, 0),
      totalCredit: entries.reduce((sum, e) => sum + e.credit, 0),
      finalBalance: runningBalance,
    })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching ekstre:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

