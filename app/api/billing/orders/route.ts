import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { isBillingCycle } from "@/lib/billing/constants"
import { isPaidActive, isTrialActive, resolveAccountRootId } from "@/lib/billing/entitlements"
import { checkQuotaOnlyOrder } from "@/lib/billing/quota-order"
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

    // SATIN ALMA YETKİSİ HESAP YÖNETİCİSİNDE. Abonelik firma bazında olsa da ödemeyi
    // hesabın sahibi yapar: şubeye atanmış bir ADMIN (ör. şube sorumlusu) ana firmanın
    // kartıyla ya da onun adına fatura kesilecek bir satın alma başlatamamalı.
    // Kökün kendi ekranında bu kontrol zaten yukarıdakiyle aynı sonucu verir.
    if (rootId !== companyId && !user.isSuperAdmin) {
      const rootAdmin = await prisma.userCompany.findFirst({
        where: { userId: user.id, companyId: rootId, role: "ADMIN" },
        select: { id: true },
      })
      if (!rootAdmin) {
        return NextResponse.json(
          {
            error:
              "Bu firmanın aboneliğini yalnızca hesap yöneticisi (ana firmanın yöneticisi) satın alabilir",
          },
          { status: 403 },
        )
      }
    }

    // KOTA YALNIZ HESAP KÖKÜNDEN ALINIR. Şube ya da ek firma kendi şubesini/ek firmasını
    // açamaz: hem hesap ağacı sonsuza dallanırdı hem de kota tek havuz olarak kökün
    // abonelik satırında tutuluyor (`getAccountQuotas`). Modül aboneliği ise her firmanın
    // kendisine aittir — bu uç ikisini aynı istekte taşıyabilir, o yüzden kapı burada.
    const wantsQuota = Number(body?.branchQuota ?? 0) > 0 || Number(body?.companyQuota ?? 0) > 0
    if (wantsQuota && rootId !== companyId) {
      return NextResponse.json(
        {
          error:
            "Şube ve ek firma kotası yalnızca ana firmadan (hesap kökü) satın alınabilir. " +
            "Bu firmadan yalnızca kendi modül aboneliğini alabilirsiniz.",
        },
        { status: 400 },
      )
    }

    // Fiyat SUNUCUDA çözülür; "kodu uygula" ucu da aynı fonksiyonu çağırır ki ekranda
    // görünen tutar ile tahsil edilen tutar ayrışmasın ([[lib/billing/order-amount.ts]]).
    const priced = await resolvePackageOrderAmount(body)
    if (!priced.ok) {
      return NextResponse.json({ error: priced.error }, { status: priced.status })
    }
    const { computed, planId, planName } = priced

    // MODÜLSÜZ ("yalnız kota") SİPARİŞ KAPISI. Bu sipariş ödeme sonrası "kota takviyesi"
    // olarak işlenir: dönem uzamaz, modüller değişmez, kota düşmez. Dolayısıyla kotayı da
    // artırmıyorsa müşteri paranın karşılığında hiçbir şey almaz; abonelik aktif değilse
    // de aldığı kotayı kullanamaz (`getAccountQuotas` fail-closed). Kural saf ve testli:
    // [[lib/billing/quota-order.ts]].
    const quotaOnly =
      computed.resolvedModules.length === 0 &&
      (computed.branchQuota > 0 || computed.companyQuota > 0)
    if (quotaOnly) {
      const sub = await prisma.subscription.findFirst({
        where: { companyId: rootId },
        orderBy: { createdAt: "desc" },
      })
      const guard = checkQuotaOnlyOrder({
        quotaOnly,
        branchQuota: computed.branchQuota,
        companyQuota: computed.companyQuota,
        existing: sub
          ? {
              branchQuota: sub.branchQuota,
              companyQuota: sub.companyQuota,
              // `getAccountQuotas` ile AYNI ölçü; ayrışırsa ekran "hakkın var" derken
              // uç 400 döndürür.
              active: isPaidActive(sub) || isTrialActive(sub),
            }
          : null,
      })
      if (!guard.ok) {
        return NextResponse.json({ error: guard.error }, { status: 400 })
      }
    }

    // İNDİRİM KODU — hesap KÖKÜ üzerinden değerlendirilir: "firma başına 1 kez" hakkını
    // hesabın tüm firmaları PAYLAŞIR. Abonelik firma bazına indi ama kod bilerek hesap
    // bazında kaldı; aksi halde tek kullanımlık bir kod şube sayısı kadar çoğalırdı.
    // Geçersiz kodda sipariş açılmaz.
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
    // Alıcı SATIN ALAN FİRMADIR: abonelik artık firma bazında olduğu için fatura da o
    // firmaya kesilir. Şubede bu, ana firmayla aynı tüzel kişidir (VKN devralınır);
    // ek firmada ise kendi VKN'sine kesilmesi zaten doğrusuydu.
    const buyerCompany = await prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, taxNumber: true, taxOffice: true, address: true, city: true, email: true },
    })
    const billing = normalizeBillingInput(
      body?.billing ?? {
        name: buyerCompany?.name,
        taxNumber: buyerCompany?.taxNumber,
        taxOffice: buyerCompany?.taxOffice,
        address: buyerCompany?.address,
        city: buyerCompany?.city,
        email: buyerCompany?.email,
      },
    )
    if (!billing.ok) {
      return NextResponse.json({ error: billing.error, fields: billing.fields }, { status: 412 })
    }
    if (buyerCompany) {
      const patch = companyFillFromBilling(buyerCompany, billing.value)
      if (Object.keys(patch).length > 0) {
        await prisma.company.update({ where: { id: companyId }, data: patch })
      }
    }

    const order = await prisma.packageOrder.create({
      data: {
        // Sipariş SATIN ALAN firmaya yazılır; ödeme onaylanınca abonelik de o firmada
        // açılır (bkz. lib/billing/paytr-payment.ts → `order.companyId`).
        companyId,
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
