import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = 'force-dynamic'


export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    const startDate = searchParams.get("startDate")
    const endDate = searchParams.get("endDate")
    const period = searchParams.get("period") || "monthly"

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    let dateFilter: any = {}
    if (startDate && endDate) {
      dateFilter = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      }
    } else {
      const now = new Date()
      if (period === "yearly") {
        dateFilter = {
          gte: new Date(now.getFullYear(), 0, 1),
          lte: new Date(now.getFullYear(), 11, 31),
        }
      } else {
        dateFilter = {
          gte: new Date(now.getFullYear(), now.getMonth(), 1),
          lte: new Date(now.getFullYear(), now.getMonth() + 1, 0),
        }
      }
    }

    // Get income transactions. Bir faturaya bağlı (tahsilat/ödeme eşleştirmesiyle
    // oluşan) işlemler faturanın kendisiyle birlikte sayılırsa gelir/gider çift
    // sayılır; bu yüzden yalnızca faturasız ("serbest") işlemler dahil edilir.
    const incomeTransactions = await prisma.transaction.findMany({
      where: {
        companyId,
        type: "INCOME",
        date: dateFilter,
        invoicePayments: { none: {} },
      },
    })

    // Get expense transactions
    const expenseTransactions = await prisma.transaction.findMany({
      where: {
        companyId,
        type: "EXPENSE",
        date: dateFilter,
        invoicePayments: { none: {} },
      },
    })

    // Get sales invoices
    const salesInvoices = await prisma.invoice.findMany({
      where: {
        companyId,
        type: "SALES",
        date: dateFilter,
        status: { notIn: ["CANCELLED", "CONVERTED"] },
      },
    })

    // Get purchase invoices
    const purchaseInvoices = await prisma.invoice.findMany({
      where: {
        companyId,
        type: "PURCHASE",
        date: dateFilter,
        status: { notIn: ["CANCELLED", "CONVERTED"] },
      },
    })

    const totalIncome =
      incomeTransactions.reduce((sum, t) => sum + Number(t.amount), 0) +
      salesInvoices.reduce((sum, i) => sum + Number(i.totalAmount), 0)

    const totalExpense =
      expenseTransactions.reduce((sum, t) => sum + Number(t.amount), 0) +
      purchaseInvoices.reduce((sum, i) => sum + Number(i.totalAmount), 0)

    const profit = totalIncome - totalExpense

    // Group by month for chart data
    const monthlyData: Record<string, { income: number; expense: number }> = {}

    incomeTransactions.forEach((t) => {
      const month = new Date(t.date).toISOString().slice(0, 7)
      if (!monthlyData[month]) {
        monthlyData[month] = { income: 0, expense: 0 }
      }
      monthlyData[month].income += Number(t.amount)
    })

    expenseTransactions.forEach((t) => {
      const month = new Date(t.date).toISOString().slice(0, 7)
      if (!monthlyData[month]) {
        monthlyData[month] = { income: 0, expense: 0 }
      }
      monthlyData[month].expense += Number(t.amount)
    })

    salesInvoices.forEach((i) => {
      const month = new Date(i.date).toISOString().slice(0, 7)
      if (!monthlyData[month]) {
        monthlyData[month] = { income: 0, expense: 0 }
      }
      monthlyData[month].income += Number(i.totalAmount)
    })

    purchaseInvoices.forEach((i) => {
      const month = new Date(i.date).toISOString().slice(0, 7)
      if (!monthlyData[month]) {
        monthlyData[month] = { income: 0, expense: 0 }
      }
      monthlyData[month].expense += Number(i.totalAmount)
    })

    const chartData = Object.entries(monthlyData)
      .map(([month, data]) => ({
        month,
        income: data.income,
        expense: data.expense,
        profit: data.income - data.expense,
      }))
      .sort((a, b) => a.month.localeCompare(b.month))

    return NextResponse.json({
      period,
      startDate: dateFilter.gte,
      endDate: dateFilter.lte,
      totals: {
        income: totalIncome,
        expense: totalExpense,
        profit,
      },
      chartData,
    })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error generating income-expense report:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
})

