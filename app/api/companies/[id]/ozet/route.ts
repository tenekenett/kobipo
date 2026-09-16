import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Şube Bilgileri ekranının işlem özeti: sayımlar + son 8 fatura.
 *
 * Ekran eskiden bunları üç TAM listeyi (kalemli fatura listesi, tüm cariler, tüm
 * ürünler) çekip istemcide `.length` alarak hesaplıyordu — 300 faturalık firmada
 * ~1,5 MB'lık bir açılış. Sayım DB'de yapılır, satırlar uygulamaya gelmez.
 * Ölçüler ekrandakiyle aynıdır: satış = `type=SALES` (durum süzgeci yok).
 */
export const GET = withApiErrors(async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = await params
    const companyId = (await resolveCompanyId(id)) ?? id
    await ensureCompanyAccess(companyId)

    const [sales, customerCount, productCount, recent] = await Promise.all([
      prisma.invoice.aggregate({
        where: { companyId, type: "SALES" },
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      prisma.customer.count({ where: { companyId } }),
      prisma.product.count({ where: { companyId } }),
      prisma.invoice.findMany({
        where: { companyId },
        select: {
          id: true,
          invoiceNo: true,
          type: true,
          status: true,
          date: true,
          totalAmount: true,
          customer: { select: { name: true } },
          supplier: { select: { name: true } },
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: 8,
      }),
    ])

    return NextResponse.json({
      salesTotal: Number(sales._sum.totalAmount ?? 0),
      salesCount: sales._count._all,
      customerCount,
      productCount,
      recent,
    })
  } catch (error: any) {
    if (typeof error?.message === "string" && error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error building company summary:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
