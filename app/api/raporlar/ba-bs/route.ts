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
    const year = searchParams.get("year") || new Date().getFullYear().toString()
    const month = searchParams.get("month") || (new Date().getMonth() + 1).toString()
    const format = searchParams.get("format")

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    const startDate = new Date(parseInt(year), parseInt(month) - 1, 1)
    const endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59)

    // Ba-Bs Formu: Alış ve satış faturalarının özeti
    const salesInvoices = await prisma.invoice.findMany({
      where: {
        companyId,
        type: "SALES",
        status: { not: "CANCELLED" },
        date: { gte: startDate, lte: endDate },
      },
      include: {
        customer: true,
        items: true,
      },
    })

    const purchaseInvoices = await prisma.invoice.findMany({
      where: {
        companyId,
        type: "PURCHASE",
        status: { not: "CANCELLED" },
        date: { gte: startDate, lte: endDate },
      },
      include: {
        supplier: true,
        items: true,
      },
    })

    const salesTotal = salesInvoices.reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0)
    const salesVAT = salesInvoices.reduce((sum, inv) => sum + Number(inv.vatAmount || 0), 0)
    const salesNet = salesInvoices.reduce((sum, inv) => sum + Number(inv.netAmount || 0), 0)

    const purchaseTotal = purchaseInvoices.reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0)
    const purchaseVAT = purchaseInvoices.reduce((sum, inv) => sum + Number(inv.vatAmount || 0), 0)
    const purchaseNet = purchaseInvoices.reduce((sum, inv) => sum + Number(inv.netAmount || 0), 0)

    const payload = {
      period: {
        year: parseInt(year),
        month: parseInt(month),
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
      sales: {
        count: salesInvoices.length,
        netAmount: salesNet,
        vatAmount: salesVAT,
        totalAmount: salesTotal,
        invoices: salesInvoices.map(inv => ({
          invoiceNo: inv.invoiceNo,
          date: inv.date.toISOString(),
          customer: inv.customer ? {
            name: inv.customer.name,
            taxNumber: inv.customer.taxNumber,
          } : null,
          netAmount: Number(inv.netAmount),
          vatAmount: Number(inv.vatAmount),
          totalAmount: Number(inv.totalAmount),
        })),
      },
      purchases: {
        count: purchaseInvoices.length,
        netAmount: purchaseNet,
        vatAmount: purchaseVAT,
        totalAmount: purchaseTotal,
        invoices: purchaseInvoices.map(inv => ({
          invoiceNo: inv.invoiceNo,
          date: inv.date.toISOString(),
          supplier: inv.supplier ? {
            name: inv.supplier.name,
            taxNumber: inv.supplier.taxNumber,
          } : null,
          netAmount: Number(inv.netAmount),
          vatAmount: Number(inv.vatAmount),
          totalAmount: Number(inv.totalAmount),
        })),
      },
    }

    if (format === "csv") {
      const rows = ["Tip,FaturaNo,Tarih,KarsiTaraf,Net,KDV,Toplam"]
      payload.sales.invoices.forEach((invoice) => {
        rows.push(`SATIS,${invoice.invoiceNo},${invoice.date},${invoice.customer?.name || ""},${invoice.netAmount},${invoice.vatAmount},${invoice.totalAmount}`)
      })
      payload.purchases.invoices.forEach((invoice) => {
        rows.push(`ALIS,${invoice.invoiceNo},${invoice.date},${invoice.supplier?.name || ""},${invoice.netAmount},${invoice.vatAmount},${invoice.totalAmount}`)
      })
      return new NextResponse(rows.join("\n"), {
        headers: { "Content-Type": "text/csv; charset=utf-8" },
      })
    }

    return NextResponse.json(payload)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error generating Ba-Bs form:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

