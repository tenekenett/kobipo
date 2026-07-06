import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import {
  createPartnerProvider,
  PARTNER_NOT_CONFIGURED_ERROR,
} from "@/lib/integrations/e-invoice/partner"

export const dynamic = "force-dynamic"

/**
 * Bayi (İş Ortağı) self-servis e-Dönüşüm hesap açma orkestrasyonu.
 * Müşteri Mysoft ile hiç muhatap olmadan Kobipo'dan hesabını açar:
 *   1) addTenant   → firmayı bayi altında açar
 *   2) addTenantActivation (ürün başına) → GİB'e aktivasyon başvurusu
 *   3) Company.eDonusum* durum alanlarını günceller + SystemLog
 *
 * Tüm çağrılar BAYİ kimliğiyle (createPartnerProvider) yapılır — firmanın kendi
 * Mysoft kullanıcısı yoktur. Aktivasyon GİB onayı asenkron olduğundan sonuç
 * ACTIVATION_PENDING'dir; durum /api/e-donusum/onboarding/status ile poll edilir.
 * Detaylı plan: docs/e-donusum-onboarding/PLAN.md
 *
 * NOT: Ortam (test/canlı) bayi kimliğine bağlıdır (MYSOFT_PARTNER_API_URL) — firma
 * bazlı test/canlı seçici burada geçerli değildir.
 */

// Aktivasyonu desteklediğimiz ürünler (Swagger activationProductType enum alt kümesi).
const SUPPORTED_PRODUCTS = new Set([
  "EInvoice",
  "EArchive",
  "EDespatch",
  "ESEVoucher",
  "EProducerVoucher",
])
// Seri ön ek (3 karakter) zorunlu olan ürünler.
const PREFIX_REQUIRED = new Set(["EInvoice", "EArchive", "EDespatch"])

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const companyId = await resolveCompanyId(body?.companyId)
    if (!companyId) {
      return NextResponse.json({ success: false, error: "companyId zorunlu" }, { status: 400 })
    }

    await ensureCompanyAccess(companyId)
    assertEInvoiceRuntimeReady()

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        name: true,
        taxNumber: true,
        taxOffice: true,
        email: true,
        phone: true,
        eDonusumOnboardingStatus: true,
        eDonusumTenantCreatedAt: true,
        eDonusumActivatedProducts: true,
      },
    })
    if (!company) return NextResponse.json({ success: false, error: "Firma bulunamadı" }, { status: 404 })

    const vkn = (company.taxNumber || "").replace(/\D/g, "")
    if (!/^\d{10,11}$/.test(vkn)) {
      return NextResponse.json(
        { success: false, error: "Firma VKN/TCKN geçersiz. Firma Ayarları'ndan 10 (VKN) veya 11 (TCKN) haneli numarayı girin." },
        { status: 400 },
      )
    }

    // Ürünleri normalize + doğrula
    const rawProducts: any[] = Array.isArray(body?.products) ? body.products : []
    const products = rawProducts
      .map((p) => ({
        type: String(p?.type || "").trim(),
        serialNumberPrefix:
          typeof p?.serialNumberPrefix === "string" ? p.serialNumberPrefix.trim().toUpperCase() : "",
        internetSerialNumberPrefix:
          typeof p?.internetSerialNumberPrefix === "string"
            ? p.internetSerialNumberPrefix.trim().toUpperCase()
            : "",
        aliasPrefix: typeof p?.aliasPrefix === "string" ? p.aliasPrefix.trim() : "",
        aliasDomain: typeof p?.aliasDomain === "string" ? p.aliasDomain.trim() : "",
      }))
      .filter((p) => p.type)

    if (products.length === 0) {
      return NextResponse.json(
        { success: false, error: "En az bir ürün seçilmeli (ör. EInvoice, EArchive)." },
        { status: 400 },
      )
    }
    for (const p of products) {
      if (!SUPPORTED_PRODUCTS.has(p.type)) {
        return NextResponse.json({ success: false, error: `Desteklenmeyen ürün: ${p.type}` }, { status: 400 })
      }
      if (PREFIX_REQUIRED.has(p.type) && !/^[A-Z0-9]{3}$/.test(p.serialNumberPrefix)) {
        return NextResponse.json(
          { success: false, error: `${p.type} için 3 karakterlik seri ön ek (prefix) zorunlu — ör. "ABC".` },
          { status: 400 },
        )
      }
    }

    const provider = createPartnerProvider()
    if (!provider) {
      return NextResponse.json({ success: false, error: PARTNER_NOT_CONFIGURED_ERROR }, { status: 400 })
    }

    const registerNo =
      typeof body?.registerNo === "string" && body.registerNo.trim() ? body.registerNo.trim() : vkn
    const email =
      typeof body?.email === "string" && body.email.trim()
        ? body.email.trim()
        : company.email || user.email || ""
    if (!email) {
      return NextResponse.json(
        { success: false, error: "Firma e-posta adresi gerekli — Firma Ayarları'ndan girin." },
        { status: 400 },
      )
    }

    // 1) Firma aç — daha önce açıldıysa atla (idempotent).
    let tenantId: number | undefined
    const alreadyCreated =
      Boolean(company.eDonusumTenantCreatedAt) ||
      ["TENANT_CREATED", "ACTIVATION_PENDING", "ACTIVE"].includes(
        company.eDonusumOnboardingStatus || "",
      )

    if (!alreadyCreated) {
      const created = await provider.createTenant({
        tenantName: company.name,
        shortName: company.name.slice(0, 50),
        vknTckn: vkn,
        email,
        registerNo,
        taxOfficeName: company.taxOffice || undefined,
        telephone: company.phone || undefined,
      })
      if (!created.success) {
        const msg = created.error || "Firma açılamadı"
        // Mysoft "zaten kayıtlı" derse firma vardır — aktivasyona devam et.
        const existsHint = /kayıtl|kayitl|mevcut|already|zaten|bulunmakta|tanımlı/i.test(msg)
        if (!existsHint) {
          await prisma.company.update({
            where: { id: companyId },
            data: { eDonusumOnboardingStatus: "FAILED", eDonusumActivationError: msg },
          })
          return NextResponse.json({ success: false, error: msg, stage: "createTenant" }, { status: 502 })
        }
        console.warn("[onboarding] createTenant: firma zaten var kabul edildi →", msg)
      } else {
        tenantId = created.tenantId
      }

      await prisma.company.update({
        where: { id: companyId },
        data: {
          eDonusumProvider: "mysoft",
          eDonusumIntegrator: "OZEL_ENTEGRATOR",
          eDonusumTenantVkn: vkn,
          eDonusumOnboardingStatus: "TENANT_CREATED",
          eDonusumTenantCreatedAt: new Date(),
          eDonusumActivationError: null,
        },
      })
    }

    // 2) Ürünleri aktive et (GİB başvurusu). Her biri bağımsız — biri patlarsa
    // diğerleri denenmeye devam eder, sonuçlar toplanır.
    const activations: Array<{ type: string; ok: boolean; activationId?: number; error?: string }> = []
    for (const p of products) {
      const r = await provider.activateProduct({
        vknTckn: vkn,
        activationProductType: p.type,
        serialNumberPrefix: p.serialNumberPrefix || undefined,
        internetSerialNumberPrefix: p.internetSerialNumberPrefix || undefined,
        aliasPrefix: p.aliasPrefix || undefined,
        aliasDomain: p.aliasDomain || undefined,
      })
      activations.push({ type: p.type, ok: r.success, activationId: r.activationId, error: r.error })
    }

    const okTypes = activations.filter((a) => a.ok).map((a) => a.type)
    const anyFail = activations.some((a) => !a.ok)
    const mergedProducts = Array.from(
      new Set([...(company.eDonusumActivatedProducts || []), ...okTypes]),
    )
    const status = okTypes.length > 0 ? "ACTIVATION_PENDING" : "FAILED"
    const firstError = activations.find((a) => !a.ok)?.error || null

    await prisma.company.update({
      where: { id: companyId },
      data: {
        eDonusumOnboardingStatus: status,
        eDonusumActivatedProducts: mergedProducts,
        eDonusumActivationError: anyFail ? firstError : null,
      },
    })

    await prisma.systemLog.create({
      data: {
        userId: user.id,
        action: "EDONUSUM_ONBOARDING",
        entity: "Company",
        entityId: companyId,
        details: `Firma ${company.name} (VKN ${vkn}) onboarding — tenant: ${
          tenantId ?? "mevcut"
        }, aktivasyon: ${activations.map((a) => `${a.type}:${a.ok ? "OK" : "HATA"}`).join(", ")}`,
        level: anyFail ? "WARN" : "INFO",
      },
    })

    return NextResponse.json({
      success: okTypes.length > 0,
      tenantId,
      status,
      activations,
      error: okTypes.length === 0 ? firstError || "Aktivasyon başarısız" : undefined,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 })
    }
    console.error("e-donusum onboarding POST error:", error)
    return NextResponse.json({ success: false, error: message || "Onboarding sırasında hata oluştu" }, { status: 500 })
  }
}
