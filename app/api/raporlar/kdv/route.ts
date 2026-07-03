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
    const period = searchParams.get("period") || "monthly" // monthly or yearly

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
      // Default to current month/year
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

    // Get invoices
    const invoices = await prisma.invoice.findMany({
      where: {
        companyId,
        date: dateFilter,
        status: { not: "CANCELLED" },
      },
      include: {
        items: true,
      },
    })

    // Calculate VAT by rate
    const vatByRate: Record<number, { net: number; vat: number; total: number }> = {}

    invoices.forEach((invoice) => {
      invoice.items.forEach((item) => {
        const vatRate = Number(item.vatRate)
        if (!vatByRate[vatRate]) {
          vatByRate[vatRate] = { net: 0, vat: 0, total: 0 }
        }

        const itemNet = Number(item.quantity) * Number(item.unitPrice)
        const itemVat = Number(item.vatAmount)
        const itemTotal = Number(item.totalAmount)

        vatByRate[vatRate].net += itemNet
        vatByRate[vatRate].vat += itemVat
        vatByRate[vatRate].total += itemTotal
      })
    })

    const vatReport = Object.entries(vatByRate).map(([rate, amounts]) => ({
      vatRate: parseFloat(rate),
      netAmount: amounts.net,
      vatAmount: amounts.vat,
      totalAmount: amounts.total,
    }))

    const totalNet = vatReport.reduce((sum, item) => sum + item.netAmount, 0)
    const totalVat = vatReport.reduce((sum, item) => sum + item.vatAmount, 0)
    const totalAmount = vatReport.reduce((sum, item) => sum + item.totalAmount, 0)

    return NextResponse.json({
      period,
      startDate: dateFilter.gte,
      endDate: dateFilter.lte,
      vatByRate: vatReport,
      totals: {
        netAmount: totalNet,
        vatAmount: totalVat,
        totalAmount: totalAmount,
      },
    })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error generating VAT report:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

