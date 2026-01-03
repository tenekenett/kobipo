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
    const asOfDate = searchParams.get("asOfDate")

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    const date = asOfDate ? new Date(asOfDate) : new Date()

    // Aktifler (Varlıklar)
    // - Nakit ve banka hesapları
    const cashAndBanks = await prisma.financialAccount.aggregate({
      where: {
        companyId,
        isActive: true,
      },
      _sum: {
        balance: true,
      },
    })

    // - Alacaklar (Müşteri bakiyeleri - ödenmemiş faturalar)
    const receivables = await prisma.invoice.aggregate({
      where: {
        companyId,
        type: "SALES",
        status: { not: "CANCELLED" },
        date: { lte: date },
      },
      _sum: {
        totalAmount: true,
      },
    })

    // Ödenen tutarları çıkar
    const paidAmount = await prisma.invoicePayment.aggregate({
      where: {
        companyId,
        invoice: {
          type: "SALES",
          date: { lte: date },
        },
        paymentDate: { lte: date },
      },
      _sum: {
        amount: true,
      },
    })

    const netReceivables = Number(receivables._sum.totalAmount || 0) - Number(paidAmount._sum.amount || 0)

    // - Stok değeri
    const inventory = await prisma.product.aggregate({
      where: {
        companyId,
        isActive: true,
      },
      _sum: {
        stockQuantity: true,
      },
    })

    // Stok değeri için ortalama maliyet kullanılabilir (şimdilik basit hesaplama)
    const inventoryValue = Number(inventory._sum.stockQuantity || 0) * 0 // TODO: Ortalama maliyet hesaplama

    // Pasifler (Yükümlülükler)
    // - Borçlar (Tedarikçi bakiyeleri - ödenmemiş faturalar)
    const payables = await prisma.invoice.aggregate({
      where: {
        companyId,
        type: "PURCHASE",
        status: { not: "CANCELLED" },
        date: { lte: date },
      },
      _sum: {
        totalAmount: true,
      },
    })

    const paidToSuppliers = await prisma.invoicePayment.aggregate({
      where: {
        companyId,
        invoice: {
          type: "PURCHASE",
          date: { lte: date },
        },
        paymentDate: { lte: date },
      },
      _sum: {
        amount: true,
      },
    })

    const netPayables = Number(payables._sum.totalAmount || 0) - Number(paidToSuppliers._sum.amount || 0)

    // Öz Sermaye
    // - Başlangıç sermayesi (şimdilik 0, daha sonra Company modeline eklenebilir)
    const initialCapital = 0

    // - Kar/Zarar (dönem karı)
    const profitLoss = await prisma.accountingEntry.aggregate({
      where: {
        companyId,
        date: { lte: date },
      },
      _sum: {
        amount: true,
      },
    })

    const equity = initialCapital + Number(profitLoss._sum.amount || 0)

    const assets = {
      cashAndBanks: Number(cashAndBanks._sum.balance || 0),
      receivables: netReceivables > 0 ? netReceivables : 0,
      inventory: inventoryValue,
      total: Number(cashAndBanks._sum.balance || 0) + (netReceivables > 0 ? netReceivables : 0) + inventoryValue,
    }

    const liabilities = {
      payables: netPayables > 0 ? netPayables : 0,
      total: netPayables > 0 ? netPayables : 0,
    }

    return NextResponse.json({
      asOfDate: date.toISOString(),
      assets,
      liabilities,
      equity,
      total: assets.total,
      totalLiabilitiesAndEquity: liabilities.total + equity,
    })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error generating balance sheet:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

