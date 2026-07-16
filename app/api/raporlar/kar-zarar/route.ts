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

    // Gelirler (Satış faturaları)
    const salesInvoices = await prisma.invoice.aggregate({
      where: {
        companyId,
        type: "SALES",
        status: { notIn: ["CANCELLED", "CONVERTED"] },
        date: { gte: start, lte: end },
      },
      _sum: {
        netAmount: true,
        vatAmount: true,
        totalAmount: true,
      },
    })

    // Giderler (Alış faturaları)
    const purchaseInvoices = await prisma.invoice.aggregate({
      where: {
        companyId,
        type: "PURCHASE",
        status: { notIn: ["CANCELLED", "CONVERTED"] },
        date: { gte: start, lte: end },
      },
      _sum: {
        netAmount: true,
        vatAmount: true,
        totalAmount: true,
      },
    })

    // Diğer gelirler (Transaction INCOME). Faturaya bağlı tahsilat işlemleri
    // satış faturasıyla birlikte zaten gelir yazıldığından hariç tutulur
    // (çift sayımı önler) — yalnızca faturasız serbest gelirler.
    const otherIncome = await prisma.transaction.aggregate({
      where: {
        companyId,
        type: "INCOME",
        date: { gte: start, lte: end },
        invoicePayments: { none: {} },
      },
      _sum: {
        amount: true,
      },
    })

    // Diğer giderler (Transaction EXPENSE) — faturaya bağlı ödemeler hariç.
    const otherExpense = await prisma.transaction.aggregate({
      where: {
        companyId,
        type: "EXPENSE",
        date: { gte: start, lte: end },
        invoicePayments: { none: {} },
      },
      _sum: {
        amount: true,
      },
    })

    const revenue = Number(salesInvoices._sum.netAmount || 0) + Number(otherIncome._sum.amount || 0)
    const costOfGoodsSold = Number(purchaseInvoices._sum.netAmount || 0)
    const grossProfit = revenue - costOfGoodsSold
    const operatingExpenses = Number(otherExpense._sum.amount || 0)
    const netProfit = grossProfit - operatingExpenses

    return NextResponse.json({
      period: {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      },
      revenue: {
        sales: Number(salesInvoices._sum.netAmount || 0),
        other: Number(otherIncome._sum.amount || 0),
        total: revenue,
      },
      costOfGoodsSold,
      grossProfit,
      operatingExpenses,
      netProfit,
    })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error generating profit/loss report:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

