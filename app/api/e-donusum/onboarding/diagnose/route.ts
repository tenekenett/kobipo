import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import {
  createPartnerProvider,
  PARTNER_NOT_CONFIGURED_ERROR,
} from "@/lib/integrations/e-invoice/partner"

export const dynamic = "force-dynamic"

/**
 * TEŞHİS ucu — HİÇBİR ŞEY YAZMAZ, sadece okur (4 adet GET).
 *
 * Onboarding takıldığında "Mysoft tarafında bu firma gerçekte ne durumda?" sorusunu
 * tek çağrıda cevaplar. Bayi kimliğiyle çalışır (createPartnerProvider), çünkü firma
 * kendi Mysoft kullanıcısına sahip değildir.
 *
 * Neden var: aktivasyon "Üzerinize tanımlı aktivasyon ürün bilgisi bulunmamaktadır."
 * dönüyor ama tenant'ta sözleşme kaydı GÖRÜNÜYOR (2026-08-04). Sözleşmenin gerçekte
 * ne olduğunu (tariffCode / tarih aralığı / kontör) görmeden doğru düzeltme yapılamaz.
 *
 * Kullanım: GET /api/e-donusum/onboarding/diagnose?vkn=0860998219
 * Yalnızca süper admin.
 */
export async function GET(request: Request) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  try {
    assertEInvoiceRuntimeReady()

    const vkn = (new URL(request.url).searchParams.get("vkn") || "").replace(/\D/g, "")
    if (!/^\d{10,11}$/.test(vkn)) {
      return NextResponse.json({ error: "vkn parametresi zorunlu (10 veya 11 hane)" }, { status: 400 })
    }

    const provider = createPartnerProvider()
    if (!provider) {
      return NextResponse.json({ error: PARTNER_NOT_CONFIGURED_ERROR }, { status: 400 })
    }

    const [tariffs, contracts, activations] = await Promise.all([
      provider.getBusinessPartnerTariff(50),
      provider.getPreContract(vkn),
      provider.getTenantActivationStatus(vkn),
    ])

    return NextResponse.json({
      vkn,
      // Bayide tanımlı tarifeler (aktivasyon için hangi ürünleri satabiliyoruz).
      partnerTariffs: {
        ok: tariffs.success,
        error: tariffs.error ?? null,
        count: tariffs.data.length,
        data: tariffs.data,
      },
      // Firmaya atanmış sözleşme/tarife kayıtları — asıl merak edilen bu.
      tenantContracts: {
        ok: contracts.success,
        error: contracts.error ?? null,
        count: contracts.data.length,
        data: contracts.data,
      },
      // Firmanın aktivasyon (GİB başvuru) kayıtları.
      tenantActivations: {
        ok: activations.success,
        error: activations.error ?? null,
        count: activations.data?.length ?? 0,
        data: activations.data ?? [],
        raw: activations.raw ?? null,
      },
    })
  } catch (error: any) {
    console.error("e-donusum onboarding diagnose GET error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}
