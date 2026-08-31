import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { isBillingCycle } from "@/lib/billing/constants"
import { resolveAccountRootId } from "@/lib/billing/entitlements"
import { resolvePackageOrderAmount } from "@/lib/billing/order-amount"
import { toJsonPriceLines } from "@/lib/billing/order-lines"
import { evaluateDiscountCode } from "@/lib/billing/discount"
import { isFreeAmount, settleFreePackageOrder } from "@/lib/billing/free-order"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import {
  billingSnapshot,
  companyFillFromBilling,
  normalizeBillingInput,
} from "@/lib/invoicing/billing-info"
import { isTestPurchase } from "@/lib/invoicing/config"

export const dynamic = "force-dynamic"

/** GET — hesabın paket siparişleri (ödeme sayfası poll'ü için). */
export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const companyId = await resolveCompanyId(new URL(request.url).searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
  await ensureCompanyAccess(companyId)
  const rootId = await resolveAccountRootId(companyId)

  const orders = await prisma.packageOrder.findMany({
    where: { companyId: rootId },
    orderBy: { createdAt: "desc" },
    take: 20,
  })
  return NextResponse.json({ data: orders })
})

/**
 * POST — paket/abonelik siparişi oluştur. Tutar SUNUCUDA hesaplanır.
 * Body: { companyId, planId?, chosenModules[], branchQuota, companyQuota, billingCycle, autoRenew? }
 */
export const POST = withApiErrors(async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await request.json()
    const companyId = await resolveCompanyId(body?.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

    const access = await ensureCompanyAccess(companyId)
    if (access.role !== "ADMIN") {
      return NextResponse.json({ error: "Abonelik yönetimi yalnızca firma yöneticisine açıktır" }, { status: 403 })
    }

    const billingCycle = body?.billingCycle
    if (!isBillingCycle(billingCycle)) {
      return NextResponse.json({ error: "Geçersiz ödeme periyodu" }, { status: 400 })
    }

    const rootId = await resolveAccountRootId(companyId)

    // Fiyat SUNUCUDA çözülür; "kodu uygula" ucu da aynı fonksiyonu çağırır ki ekranda
    // görünen tutar ile tahsil edilen tutar ayrışmasın ([[lib/billing/order-amount.ts]]).
    const priced = await resolvePackageOrderAmount(body)
    if (!priced.ok) {
      return NextResponse.json({ error: priced.error }, { status: priced.status })
    }
    const { computed, planId, planName } = priced

    // İNDİRİM KODU — hesap KÖKÜ üzerinden değerlendirilir: abonelik hesaba yazılır,
    // "firma başına 1 kez" hakkını şubeler paylaşır. Geçersiz kodda sipariş açılmaz.
    let discount: { codeId: string; code: string; discountAmount: number; payable: number } | null = null
    const rawDiscountCode = String(body?.discountCode ?? "").trim()
    if (rawDiscountCode) {
      const evaluated = await evaluateDiscountCode({
        code: rawDiscountCode,
        scope: "PACKAGE",
        amount: computed.amount,
        companyId: rootId,
      })
      if (!evaluated.ok) {
        return NextResponse.json({ error: evaluated.error, field: "discountCode" }, { status: 422 })
      }
      discount = evaluated.discount
    }
    const payableAmount = discount ? discount.payable : computed.amount

    // FATURA BİLGİSİ — ödeme öncesi zorunlu ([[lib/invoicing/billing-info.ts]]).
    // Alıcı, siparişin sahibi olan HESAP KÖKÜ firmasıdır (`rootId`); abonelik oradan
    // akar ve fatura da o tüzel kişiye kesilir — isteği gönderen şube değil.
    const rootCompany = await prisma.company.findUnique({
      where: { id: rootId },
      select: { name: true, taxNumber: true, taxOffice: true, address: true, city: true, email: true },
    })
    const billing = normalizeBillingInput(
      body?.billing ?? {
        name: rootCompany?.name,
        taxNumber: rootCompany?.taxNumber,
        taxOffice: rootCompany?.taxOffice,
        address: rootCompany?.address,
        city: rootCompany?.city,
        email: rootCompany?.email,
      },
    )
    if (!billing.ok) {
      return NextResponse.json({ error: billing.error, fields: billing.fields }, { status: 412 })
    }
    if (rootCompany) {
      const patch = companyFillFromBilling(rootCompany, billing.value)
      if (Object.keys(patch).length > 0) {
        await prisma.company.update({ where: { id: rootId }, data: patch })
      }
    }

    const order = await prisma.packageOrder.create({
      data: {
        companyId: rootId,
        planId,
        planName,
        // Paket ödemeleri daima PayTR sanal POS'undan geçer.
        isTest: isTestPurchase("CARD"),
        ...billingSnapshot(billing.value),
        selectedModules: computed.extraModules,
        resolvedModules: computed.resolvedModules,
        branchQuota: computed.branchQuota,
        companyQuota: computed.companyQuota,
        billingCycle,
        // amount = TAHSİL EDİLEN tutar; liste tutarı `amount + discountAmount`.
        amount: payableAmount,
        // Kalem dökümü tutarla BİRLİKTE saklanır. Katalog fiyatları sonradan
        // değiştiğinde "bu modüle ne kadar ödedim" ancak bu snapshot'tan okunabilir.
        priceLines: toJsonPriceLines(computed.lines),
        discountCodeId: discount?.codeId ?? null,
        discountCode: discount?.code ?? null,
        discountAmount: discount?.discountAmount ?? 0,
        currency: "TRY",
        autoRenew: body?.autoRenew == null ? true : Boolean(body.autoRenew),
        status: "PENDING_PAYMENT",
        createdById: user.id,
      },
    })

    // TAM İNDİRİMLİ SİPARİŞ: sanal POS 0 TL işlem kabul etmez, ödeme adımı atlanır ve
    // sipariş burada karşılanır ([[lib/billing/free-order.ts]]). İstemci `free` bayrağını
    // görünce PayTR iframe'ini hiç açmaz.
    const free = isFreeAmount(payableAmount)
    if (free) {
      await settleFreePackageOrder(order.id)
    }

    return NextResponse.json({
      id: order.id,
      free,
      amount: payableAmount,
      listAmount: computed.amount,
      discountCode: discount?.code ?? null,
      discountAmount: discount?.discountAmount ?? 0,
      resolvedModules: computed.resolvedModules,
      branchQuota: computed.branchQuota,
      companyQuota: computed.companyQuota,
      lines: computed.lines,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("billing orders POST error:", error)
    return NextResponse.json({ error: message || "Sipariş oluşturulamadı" }, { status: 500 })
  }
})
