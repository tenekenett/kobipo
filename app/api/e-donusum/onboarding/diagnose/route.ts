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
 * Firma ÜYELİĞİ istemez (yalnız süper admin) — bilerek: teşhis edilen firma çoğu zaman
 * müşterinin firmasıdır ve bizim hesabımız o firmaya üye değildir. `check-vkn` bu yüzden
 * bu iş için kullanılamıyordu (ensureCompanyAccess → "Access denied").
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

    const [tariffs, contracts, activations, gib, partnerCredit] = await Promise.all([
      provider.getBusinessPartnerTariff(50),
      provider.getPreContract(vkn),
      provider.getTenantActivationStatus(vkn),
      provider.getGibAccount(vkn),
      // Bayi (ana iş ortağı) kontör havuzu — "firma açılınca havuzdan 250 kontör
      // düşüyor mu?" sorusunun cevabı. Şu an bu ÇIKARIM: ASDOĞUŞ'un sözleşmesinde
      // creditQty 250 / "Kontör Yüklendi" var ama kodumuz kontör yüklemedi; tek aday
      // addTenant'taki addTariffToTenant:true. Havuz rakamı bunu doğrular/çürütür.
      provider.getBusinessPartnerDocumentCreditList(1),
    ])

    // GİB mükellef sicili — "bu kayıt bizden mi, yoksa firma zaten mükellef miydi?"
    // sorusunun TEK kesin cevabı. eInvoiceStartDate bizim tenant açtığımız tarihse
    // (2026-08-03) kayıt bizim çağrımızdan doğmuştur; daha eskiyse firma zaten
    // e-Fatura mükellefiydi ve biz sadece mevcut durumu görüyoruzdur.
    const gibData = gib.success ? gib.data : null
    const gibRaw: any = gibData?.raw || {}
    const gibAliases: string[] = Array.isArray(gibRaw?.gibAccountAliasList)
      ? Array.from(
          new Set(
            gibRaw.gibAccountAliasList
              .map((a: any) => String(a?.alias || "").trim())
              .filter(Boolean),
          ),
        )
      : []

    return NextResponse.json({
      vkn,
      // ⭐ ÖNCE BURAYA BAK: kayıt bizden mi, önceden mi vardı?
      gibAccount: {
        ok: gib.success,
        error: gib.success ? null : gib.error,
        accountName: gibData?.accountName ?? null,
        isEInvoiceTaxpayer: gibData?.isEInvoiceTaxpayer ?? null,
        /** e-Fatura mükellefiyetinin GİB'deki BAŞLANGIÇ tarihi — belirleyici alan. */
        eInvoiceStartDate: gibData?.eInvoiceStartDate ?? null,
        eWaybillStartDate: gibData?.eWaybillStartDate ?? null,
        isPassive: gibData?.isPassive ?? null,
        aliases: gibAliases,
        raw: gibRaw,
      },
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
      // Bayi kontör havuzu — firma açmanın havuza maliyeti var mı?
      partnerCredit: {
        ok: partnerCredit.success,
        error: partnerCredit.error ?? null,
        count: partnerCredit.data.length,
        data: partnerCredit.data,
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
