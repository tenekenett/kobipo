import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { resolveBaseUrl } from "@/lib/utils/base-url"
import {
  createPaymentToken,
  isPaytrEnabled,
  newMerchantOid,
  PAYTR_IFRAME_BASE,
  PAYTR_NOT_CONFIGURED_ERROR,
} from "@/lib/integrations/paytr/client"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Bir paket/abonelik siparişi için PayTR ödeme token'ı üretir. İstemci dönen token
 * ile iframe'i gömer. Her istekte sipariş id'sini taşıyan BENZERSİZ bir merchant_oid
 * üretilir (PayTR aynı oid'i tekrar kabul etmez); callback base id'yi geri çözer.
 *
 * autoRenew ise `recurringPayment=true` → PayTR ilk ödemede kartı saklar; sonraki
 * dönemler yinelenen ödeme API'siyle çekilebilir (Aşama 6). noInstallment=1: abonelik
 * tek çekim, taksit yok.
 */
export const POST = withApiErrors(async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    if (!isPaytrEnabled()) {
      return NextResponse.json({ error: PAYTR_NOT_CONFIGURED_ERROR }, { status: 400 })
    }

    const { id } = await params
    const order = await prisma.packageOrder.findUnique({
      where: { id },
      include: {
        company: { select: { name: true, slug: true, phone: true, address: true, email: true } },
      },
    })
    if (!order) return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 })

    // Sipariş hesabın kök firmasına yazılır; erişim onun üzerinden doğrulanır.
    await ensureCompanyAccess(order.companyId)

    if (order.status !== "PENDING_PAYMENT") {
      return NextResponse.json({ error: "Bu sipariş için ödeme alınamaz" }, { status: 409 })
    }

    const base = resolveBaseUrl(request)
    const userIp =
      (request.headers.get("x-forwarded-for")?.split(",")[0] ||
        request.headers.get("x-real-ip") ||
        "").trim() || "0.0.0.0"
    const email = (user.email || order.company?.email || "musteri@kobipo.com").trim()
    const amount = Math.round(Number(order.amount) * 100)
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Geçersiz tutar" }, { status: 400 })
    }

    const basketLabel =
      order.planName ||
      (order.resolvedModules.length > 0 ? "Kobipo Abonelik" : "Kobipo Paket")
    const cycleLabel = order.billingCycle === "YEARLY" ? "Yıllık" : "Aylık"

    const { token } = await createPaymentToken({
      merchantOid: newMerchantOid(order.id),
      email,
      paymentAmount: amount,
      userIp,
      userBasket: [[`${basketLabel} (${cycleLabel})`, Number(order.amount).toFixed(2), 1]],
      userName: order.company?.name || "Kobipo Müşteri",
      userAddress: order.company?.address || "-",
      userPhone: order.company?.phone || "-",
      // company param'ı taşı → PayTR dönüşünde firma bağlamı korunur (aksi halde ana firmaya düşer).
      okUrl: `${base}/ayarlar/abonelik/odeme/${order.id}?odeme=ok&company=${encodeURIComponent(order.company?.slug ?? order.companyId)}`,
      failUrl: `${base}/ayarlar/abonelik/odeme/${order.id}?odeme=fail&company=${encodeURIComponent(order.company?.slug ?? order.companyId)}`,
      noInstallment: 1,
      recurringPayment: order.autoRenew,
    })

    return NextResponse.json({ token, iframeUrl: `${PAYTR_IFRAME_BASE}${token}` })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("billing paytr-token error:", error)
    return NextResponse.json({ error: message || "PayTR token alınamadı" }, { status: 500 })
  }
})
