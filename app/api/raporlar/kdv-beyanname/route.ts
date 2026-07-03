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
    const period = searchParams.get("period") || "monthly" // monthly, quarterly, yearly
    const year = searchParams.get("year") || new Date().getFullYear().toString()
    const month = searchParams.get("month") || (new Date().getMonth() + 1).toString()

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    let startDate: Date
    let endDate: Date

    if (period === "monthly") {
      startDate = new Date(parseInt(year), parseInt(month) - 1, 1)
      endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59)
    } else if (period === "quarterly") {
      const quarter = parseInt(month) // 1, 2, 3, 4
      startDate = new Date(parseInt(year), (quarter - 1) * 3, 1)
      endDate = new Date(parseInt(year), quarter * 3, 0, 23, 59, 59)
    } else {
      // yearly
      startDate = new Date(parseInt(year), 0, 1)
      endDate = new Date(parseInt(year), 11, 31, 23, 59, 59)
    }

    // Satış faturalarından KDV (Hesaplanan KDV)
    const salesVAT = await prisma.invoiceItem.groupBy({
      by: ["vatRate"],
      where: {
        invoice: {
          companyId,
          type: "SALES",
          status: { not: "CANCELLED" },
          date: { gte: startDate, lte: endDate },
        },
      },
      _sum: {
        vatAmount: true,
        totalAmount: true,
      },
    })

    // Alış faturalarından KDV (İndirilecek KDV)
    const purchaseVAT = await prisma.invoiceItem.groupBy({
      by: ["vatRate"],
      where: {
        invoice: {
          companyId,
          type: "PURCHASE",
          status: { not: "CANCELLED" },
          date: { gte: startDate, lte: endDate },
        },
      },
      _sum: {
        vatAmount: true,
        totalAmount: true,
      },
    })

    const calculatedVAT = salesVAT.reduce((sum, item) => sum + Number(item._sum.vatAmount || 0), 0)
    const deductibleVAT = purchaseVAT.reduce((sum, item) => sum + Number(item._sum.vatAmount || 0), 0)
    const netVAT = calculatedVAT - deductibleVAT

    return NextResponse.json({
      period,
      year: parseInt(year),
      month: period === "monthly" ? parseInt(month) : undefined,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      calculatedVAT,
      deductibleVAT,
      netVAT,
      breakdown: {
        sales: salesVAT.map(item => ({
          vatRate: item.vatRate,
          vatAmount: Number(item._sum.vatAmount || 0),
          totalAmount: Number(item._sum.totalAmount || 0),
        })),
        purchases: purchaseVAT.map(item => ({
          vatRate: item.vatRate,
          vatAmount: Number(item._sum.vatAmount || 0),
          totalAmount: Number(item._sum.totalAmount || 0),
        })),
      },
    })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error generating VAT declaration:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

