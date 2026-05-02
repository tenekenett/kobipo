import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    const productId = resolvedParams.id
    
    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get("companyId")
    const customerId = searchParams.get("customerId") // Opsiyonel: Sadece o cariye ait satışlar için

    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    }

    await ensureCompanyAccess(companyId)

    // 1. Tüm Fatura Hareketlerini Çek (Satış ve Alış)
    const invoiceItems = await prisma.invoiceItem.findMany({
      where: {
        productId: productId,
        invoice: {
          companyId: companyId,
          status: { not: "CANCELLED" }
        }
      },
      include: {
        invoice: {
          include: {
            customer: { select: { id: true, name: true } },
            supplier: { select: { id: true, name: true } }
          }
        }
      },
      orderBy: { invoice: { date: 'desc' } },
      take: 50 // Son 50 işlem yeterli olacaktır
    })

    // 2. Tüm Teklif Hareketlerini Çek
    const quoteItems = await prisma.quoteItem.findMany({
      where: {
        productId: productId,
        quote: {
          companyId: companyId,
        }
      },
      include: {
        quote: {
          include: {
            customer: { select: { id: true, name: true } },
            supplier: { select: { id: true, name: true } }
          }
        }
      },
      orderBy: { quote: { date: 'desc' } },
      take: 20
    })

    // 3. Verileri Sekmelere Göre Grupla
    const previousSales = invoiceItems
      .filter(item => item.invoice.type === "SALES")
      .map(item => ({
        date: item.invoice.date,
        cariName: item.invoice.customer?.name || "-",
        price: Number(item.unitPrice),
      }))

    const customerSales = invoiceItems
      .filter(item => item.invoice.type === "SALES" && customerId && item.invoice.customerId === customerId)
      .map(item => ({
        date: item.invoice.date,
        cariName: item.invoice.customer?.name || "-",
        price: Number(item.unitPrice),
      }))

    const previousPurchases = invoiceItems
      .filter(item => item.invoice.type === "PURCHASE")
      .map(item => ({
        date: item.invoice.date,
        cariName: item.invoice.supplier?.name || "-",
        price: Number(item.unitPrice),
      }))

    const quotes = quoteItems.map(item => ({
      date: item.quote.date,
      cariName: item.quote.customer?.name || item.quote.supplier?.name || "-",
      price: Number(item.unitPrice),
    }))

    return NextResponse.json({
      sales: previousSales,
      customerSales: customerSales,
      purchases: previousPurchases,
      quotes: quotes
    })

  } catch (error: any) {
    console.error("Error fetching product prices:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}