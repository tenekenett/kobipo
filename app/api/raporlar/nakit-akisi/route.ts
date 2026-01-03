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
    const startDate = searchParams.get("startDate")
    const endDate = searchParams.get("endDate")

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    const start = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), 0, 1)
    const end = endDate ? new Date(endDate) : new Date()

    // Başlangıç bakiyesi
    const startBalance = await prisma.financialAccount.aggregate({
      where: {
        companyId,
        isActive: true,
        createdAt: { lt: start },
      },
      _sum: {
        balance: true,
      },
    })

    // İşletme faaliyetlerinden nakit akışı
    // - Müşterilerden tahsilatlar
    const collections = await prisma.invoicePayment.aggregate({
      where: {
        companyId,
        paymentDate: { gte: start, lte: end },
        invoice: {
          type: "SALES",
        },
      },
      _sum: {
        amount: true,
      },
    })

    // - Tedarikçilere ödemeler
    const payments = await prisma.invoicePayment.aggregate({
      where: {
        companyId,
        paymentDate: { gte: start, lte: end },
        invoice: {
          type: "PURCHASE",
        },
      },
      _sum: {
        amount: true,
      },
    })

    // - Diğer gelirler
    const otherIncome = await prisma.transaction.aggregate({
      where: {
        companyId,
        type: "INCOME",
        date: { gte: start, lte: end },
      },
      _sum: {
        amount: true,
      },
    })

    // - Diğer giderler
    const otherExpense = await prisma.transaction.aggregate({
      where: {
        companyId,
        type: "EXPENSE",
        date: { gte: start, lte: end },
      },
      _sum: {
        amount: true,
      },
    })

    const operatingCashFlow = 
      Number(collections._sum.amount || 0) +
      Number(otherIncome._sum.amount || 0) -
      Number(payments._sum.amount || 0) -
      Number(otherExpense._sum.amount || 0)

    // Yatırım faaliyetlerinden nakit akışı (şimdilik 0)
    const investingCashFlow = 0

    // Finansman faaliyetlerinden nakit akışı (şimdilik 0)
    const financingCashFlow = 0

    const netCashFlow = operatingCashFlow + investingCashFlow + financingCashFlow

    // Bitiş bakiyesi
    const endBalance = await prisma.financialAccount.aggregate({
      where: {
        companyId,
        isActive: true,
      },
      _sum: {
        balance: true,
      },
    })

    return NextResponse.json({
      period: {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      },
      beginningBalance: Number(startBalance._sum.balance || 0),
      operatingActivities: {
        collections: Number(collections._sum.amount || 0),
        payments: Number(payments._sum.amount || 0),
        otherIncome: Number(otherIncome._sum.amount || 0),
        otherExpense: Number(otherExpense._sum.amount || 0),
        net: operatingCashFlow,
      },
      investingActivities: {
        net: investingCashFlow,
      },
      financingActivities: {
        net: financingCashFlow,
      },
      netCashFlow,
      endingBalance: Number(endBalance._sum.balance || 0),
    })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error generating cash flow report:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

