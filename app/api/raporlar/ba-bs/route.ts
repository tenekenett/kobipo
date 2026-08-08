import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { computeBaBs } from "@/lib/raporlar/vergiler"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = 'force-dynamic'

/**
 * Ba-Bs formu hazırlık raporu. Hesabın kendisi `lib/raporlar/vergiler.ts`te —
 * dışa aktarma ucu da aynı fonksiyonu çağırır.
 *
 * NOT: `format=csv` sayfalarda kullanılmıyor; düzgün kaçışlı/antetli çıktı için
 * `/api/export/rapor-vergiler` kullanılmalı.
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    const year = Number(searchParams.get("year")) || new Date().getFullYear()
    const month = Number(searchParams.get("month")) || new Date().getMonth() + 1

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    const result = await computeBaBs({ companyId, year, month })

    // Uç sözleşmesi korunuyor: kalemlerde `counterparty` yerine eskiden beri
    // `customer` / `supplier` anahtarları dönüyordu.
    return NextResponse.json({
      period: result.period,
      sales: {
        ...result.sales,
        invoices: result.sales.invoices.map(({ counterparty, ...rest }) => ({
          ...rest,
          customer: counterparty,
        })),
      },
      purchases: {
        ...result.purchases,
        invoices: result.purchases.invoices.map(({ counterparty, ...rest }) => ({
          ...rest,
          supplier: counterparty,
        })),
      },
    })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error generating Ba-Bs form:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
