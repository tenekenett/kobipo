import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { createPartnerProvider, PARTNER_NOT_CONFIGURED_ERROR } from "@/lib/integrations/e-invoice/partner"

export const dynamic = "force-dynamic"

/**
 * Bayi (İş Ortağı) tarife listesi — Mysoft getBusinessPartnerTariff.
 * Sistem-admin, paket tanımlarken hangi tariffCode'u kullanacağını buradan görür.
 */
export async function GET() {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  try {
    assertEInvoiceRuntimeReady()
    const provider = createPartnerProvider()
    if (!provider) {
      return NextResponse.json({ error: PARTNER_NOT_CONFIGURED_ERROR }, { status: 400 })
    }
    const result = await provider.getBusinessPartnerTariff(50)
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Tarife listesi alınamadı", data: [] },
        { status: 502 },
      )
    }
    return NextResponse.json({ data: result.data })
  } catch (error: any) {
    console.error("kontor tariffs GET error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}
