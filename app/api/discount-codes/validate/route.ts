import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { resolveAccountRootId } from "@/lib/billing/entitlements"
import { evaluateDiscountCode } from "@/lib/billing/discount"
import { resolvePackageOrderAmount } from "@/lib/billing/order-amount"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * POST — "Kodu uygula" kutusunun ÖN İZLEMESİ.
 *
 * Tutar İSTEMCİDEN ALINMAZ: kontörde seçilen paketin fiyatı, pakette ise seçimin
 * katalog fiyatı sunucuda yeniden hesaplanır ([[lib/billing/order-amount.ts]]).
 * Böylece bu uç ile siparişi açan uç aynı tutarı görür; ekranda başka, tahsilatta
 * başka bir indirim çıkmaz. Sipariş anında kod BİR KEZ DAHA doğrulanır — bu uç
 * yalnız kullanıcıya "ne kadar ödeyeceğim"i göstermek içindir.
 *
 * Body: { companyId, code, scope: "KONTOR" | "PACKAGE", packageId? , plan seçimi… }
 */
export const POST = withApiErrors(async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await request.json()
    const companyId = await resolveCompanyId(String(body?.companyId ?? ""))
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    await ensureCompanyAccess(companyId)

    const scope = body?.scope === "PACKAGE" ? "PACKAGE" : "KONTOR"
    const code = String(body?.code ?? "")
    if (!code.trim()) return NextResponse.json({ error: "İndirim kodu girin." }, { status: 400 })

    let amount = 0
    // Kullanım hakkı hesabın KÖKÜNDEN sayılır: abonelik hesap kökü firmasına yazılır,
    // kontör ise siparişi açan firmaya. Kod "firma başına 1 kez" ise şubeler tek
    // hakkı paylaşmalı — aksi halde her şube aynı kuponu yeniden kullanırdı.
    const scopeCompanyId = scope === "PACKAGE" ? await resolveAccountRootId(companyId) : companyId

    if (scope === "KONTOR") {
      const packageId = String(body?.packageId ?? "")

      // packageId VERİLMEDİYSE: kontör ekranı paketleri liste halinde gösterir ve
      // kullanıcı kodu paket seçmeden yazar. Her paketin indirimini SUNUCU hesaplar
      // ve hepsini birden döneriz — istemcinin kendi hesaplaması, ekranda görünen
      // tutar ile tahsil edilen tutarı ayrıştırma riski taşırdı.
      if (!packageId) {
        const packages = await prisma.kontorPackage.findMany({
          where: { isActive: true },
          orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
        })
        const results = await Promise.all(
          packages.map(async (pkg) => {
            const r = await evaluateDiscountCode({
              code,
              scope: "KONTOR",
              amount: Number(pkg.price),
              companyId: scopeCompanyId,
            })
            return r.ok
              ? {
                  packageId: pkg.id,
                  listAmount: r.discount.listAmount,
                  discountAmount: r.discount.discountAmount,
                  payable: r.discount.payable,
                  code: r.discount.code,
                  description: r.discount.description,
                }
              : { packageId: pkg.id, error: r.error }
          }),
        )
        const usable = results.filter((r) => !("error" in r))
        if (usable.length === 0) {
          // Hiçbir pakete uymadıysa sebebi ilk hatadan verilir (ör. "süresi dolmuş",
          // "en az 500 TL'lik alımlarda geçerli").
          const firstError = results.find((r) => "error" in r) as { error: string } | undefined
          return NextResponse.json(
            { error: firstError?.error || "Bu kod kullanılamıyor." },
            { status: 422 },
          )
        }
        const sample = usable[0] as { code: string; description: string | null }
        return NextResponse.json({
          code: sample.code,
          description: sample.description,
          packages: results,
        })
      }

      const pkg = await prisma.kontorPackage.findUnique({ where: { id: packageId } })
      if (!pkg || !pkg.isActive) {
        return NextResponse.json({ error: "Paket bulunamadı veya pasif" }, { status: 404 })
      }
      amount = Number(pkg.price)
    } else {
      const priced = await resolvePackageOrderAmount(body)
      if (!priced.ok) {
        return NextResponse.json({ error: priced.error }, { status: priced.status })
      }
      amount = priced.computed.amount
    }

    const result = await evaluateDiscountCode({
      code,
      scope,
      amount,
      companyId: scopeCompanyId,
    })
    if (!result.ok) {
      // 422: kod okundu ama uygulanamadı. İstemci mesajı olduğu gibi gösterir —
      // "geçersiz kod" deyip susmak süresi dolmuş kampanyayı destek çağrısına çevirir.
      return NextResponse.json({ error: result.error }, { status: 422 })
    }

    return NextResponse.json({
      code: result.discount.code,
      description: result.discount.description,
      listAmount: result.discount.listAmount,
      discountAmount: result.discount.discountAmount,
      payable: result.discount.payable,
      appliesToRenewals: result.discount.appliesToRenewals,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) return accessDeniedResponse(error)
    console.error("discount validate error:", error)
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 })
  }
})
