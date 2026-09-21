import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { checkKontorEligibility, resolveKontorTargetVkn } from "@/lib/kontor/dealer-eligibility"

export const dynamic = "force-dynamic"

/**
 * GET ?companyId= — Bu firmaya Kobipo üzerinden kontör yüklenebilir mi?
 *
 * Satın alma penceresi açılırken sorulur; cevap "hayır" ise paketler hiç gösterilmez.
 * Asıl kapı sipariş ucundadır (POST /api/kontor/orders → aynı fonksiyon); burası
 * kullanıcıyı ödeme adımına kadar yürütmemek için. Sonuç her zaman 200 döner — "yüklenemez"
 * bir hata değil, bir cevaptır; `code` sebebi söyler (NO_VKN | NOT_LISTED | UNAVAILABLE |
 * NOT_CONFIGURED).
 */
export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    await ensureCompanyAccess(companyId)

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { eDonusumTenantVkn: true, taxNumber: true },
    })
    const targetVkn = resolveKontorTargetVkn(company)
    if (!targetVkn) {
      return NextResponse.json({
        eligible: false,
        code: "NO_VKN",
        message: "Kontör yüklemesi için firmanızın VKN/TCKN bilgisi gerekli. Firma Ayarları'ndan girin.",
        targetVkn: null,
      })
    }

    const result = await checkKontorEligibility(targetVkn)
    if (!result.ok) {
      return NextResponse.json({ eligible: false, code: result.code, message: result.message, targetVkn })
    }
    return NextResponse.json({ eligible: true, code: null, message: null, targetVkn, tenantName: result.tenantName })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("kontor eligibility GET error:", error)
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 })
  }
})
