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

    // Muhtasar beyanname için ödemeler (maaş, hizmet alımları vb.)
    // Şimdilik sadece temel yapı, daha sonra detaylandırılabilir
    const payments = await prisma.transaction.findMany({
      where: {
        companyId,
        type: "EXPENSE",
        date: { gte: startDate, lte: endDate },
        description: {
          contains: "maaş",
        },
      },
      include: {
        supplier: true,
      },
    })

    // Muhtasar kesintiler (şimdilik basit hesaplama)
    // Gerçek muhtasar hesaplaması için daha detaylı kurallar gerekir
    const totalWithholding = payments.reduce((sum, payment) => {
      // Basit örnek: %15 stopaj (gerçek hesaplama daha karmaşık)
      return sum + Number(payment.amount) * 0.15
    }, 0)

    const payload = {
      period: {
        year: parseInt(year),
        month: parseInt(month),
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
      payments: payments.map(p => ({
        id: p.id,
        date: p.date.toISOString(),
        amount: Number(p.amount),
        description: p.description,
        supplier: p.supplier ? {
          name: p.supplier.name,
          taxNumber: p.supplier.taxNumber,
        } : null,
      })),
      totalWithholding,
      totalPayments: payments.reduce((sum, p) => sum + Number(p.amount), 0),
    }

    if (format === "csv") {
      const rows = ["Tarih,Tedarikci,Tutar,Stopaj"]
      payload.payments.forEach((payment) => {
        rows.push(`${payment.date},${payment.supplier?.name || ""},${payment.amount},${(payment.amount * 0.15).toFixed(2)}`)
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
    console.error("Error generating withholding tax declaration:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

