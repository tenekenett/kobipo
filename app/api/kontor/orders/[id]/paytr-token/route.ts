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
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Bir kart (CARD) kontör siparişi için PayTR ödeme token'ı üretir. İstemci dönen
 * token ile iframe'i gömer.
 *
 * merchant_oid HER denemede yeniden üretilir ([[newMerchantOid]]): sayfa yenileme,
 * "Ödemeye devam et", "Tekrar dene" ve dev'deki çift-mount hep bu ucu tekrar çağırır;
 * aynı oid ikinci kez gidince PayTR "merchant_oid daha önce kullanılmış" der ve ödeme
 * ekranı hiç açılmaz. Callback `merchantOidBase()` ile sipariş id'sine geri çözer
 * ([[lib/integrations/paytr/notification.ts]]).
 */
export async function POST(
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
    const order = await prisma.kontorOrder.findUnique({
      where: { id },
      include: {
        company: { select: { name: true, slug: true, phone: true, address: true, email: true } },
      },
    })
    if (!order) return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 })

    await ensureCompanyAccess(order.companyId)

    if (order.status !== "PENDING_PAYMENT") {
      return NextResponse.json({ error: "Bu sipariş için ödeme alınamaz" }, { status: 409 })
    }
    if (order.paymentMethod !== "CARD") {
      return NextResponse.json({ error: "Bu sipariş kart ödemesine uygun değil" }, { status: 400 })
    }

    const base = resolveBaseUrl(request)
    const userIp =
      (request.headers.get("x-forwarded-for")?.split(",")[0] ||
        request.headers.get("x-real-ip") ||
        "").trim() || "0.0.0.0"
    const email = (user.email || order.company?.email || "musteri@kobipo.com").trim()
    const amount = Math.round(Number(order.totalPrice) * 100)
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Geçersiz tutar" }, { status: 400 })
    }

    // company param'ı taşı → PayTR dönüşünde firma bağlamı korunur (aksi halde kontör
    // sayfası "Firma seçiniz" ile açılır ya da başka firmaya düşer). [[CLAUDE.md]]
    const companyParam = encodeURIComponent(order.company?.slug || order.companyId)

    const { token } = await createPaymentToken({
      merchantOid: newMerchantOid(order.id),
      email,
      paymentAmount: amount,
      userIp,
      userBasket: [[order.packageName, Number(order.totalPrice).toFixed(2), 1]],
      userName: order.company?.name || "Kobipo Müşteri",
      userAddress: order.company?.address || "-",
      userPhone: order.company?.phone || "-",
      okUrl: `${base}/e-donusum/kontor?odeme=ok&order=${order.id}&company=${companyParam}`,
      failUrl: `${base}/e-donusum/kontor?odeme=fail&order=${order.id}&company=${companyParam}`,
      noInstallment: 0,
    })

    return NextResponse.json({ token, iframeUrl: `${PAYTR_IFRAME_BASE}${token}` })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("kontor paytr-token error:", error)
    return NextResponse.json({ error: message || "PayTR token alınamadı" }, { status: 500 })
  }
}
