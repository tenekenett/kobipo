import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { resolveAccountRootId } from "@/lib/billing/entitlements"
import { normalizeBillingInput } from "@/lib/invoicing/billing-info"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Satın alma ekranlarındaki "Fatura Bilgileri" adımının ÖN DOLDURMA kaynağı.
 *
 * Sipariş uçları bilgiyi zaten doğruluyor (eksikse 412); burası yalnız kullanıcıya
 * neyin dolu neyin eksik olduğunu ödeme ekranına gelmeden göstermek içindir.
 *
 * `scope`:
 *  - "company" (varsayılan) → kontör satın alma. Alıcı, kontörün yükleneceği firmadır.
 *  - "account"              → paket/abonelik. Alıcı HESAP KÖKÜ firmasıdır; abonelik
 *    oradan akar ve fatura o tüzel kişiye kesilir, isteği açan şubeye değil.
 */
export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

    await ensureCompanyAccess(companyId)

    const targetId =
      searchParams.get("scope") === "account" ? await resolveAccountRootId(companyId) : companyId

    const company = await prisma.company.findUnique({
      where: { id: targetId },
      select: { name: true, taxNumber: true, taxOffice: true, address: true, city: true, email: true },
    })
    if (!company) return NextResponse.json({ error: "Firma bulunamadı" }, { status: 404 })

    const billing = {
      name: company.name || "",
      taxNumber: company.taxNumber || "",
      taxOffice: company.taxOffice || "",
      address: company.address || "",
      city: company.city || "",
      district: "",
      email: company.email || "",
    }
    const check = normalizeBillingInput(billing)

    return NextResponse.json({
      billing,
      complete: check.ok,
      missing: check.ok ? [] : check.fields,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) return accessDeniedResponse(error)
    console.error("billing-info GET error:", error)
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 })
  }
})
