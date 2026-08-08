import { NextResponse } from "next/server"
import { isCronAuthorized } from "@/lib/billing/cron-auth"
import { clientIpFrom, runRecurring } from "@/lib/billing/jobs"

export const dynamic = "force-dynamic"

/**
 * Yinelenen ödeme çalıştırıcı — vadesi gelmiş, otomatik yenilemeli PayTR aboneliklerini
 * saklı kartla yeniden çeker.
 *
 * Mantık [[lib/billing/jobs.ts]] → `runRecurring`. Bu uç elle çalıştırma içindir; günlük
 * koşu `/api/billing/cron/daily` orkestratörü üzerinden yapılır — **sıra önemli**, önce
 * bu, sonra `reconcile`, yoksa yenilenen abonelik kilitlenir.
 *
 * Gerçek çekim şu an [[lib/integrations/paytr/client.ts]] `chargeRecurringPayment`
 * tarafından bilinçli olarak yapılmıyor (canlı PayTR recurring ürünü + saklı kart
 * gerekir); bu durumda abonelik durumu DEĞİŞTİRİLMEZ (`pending`).
 *
 * Oturumsuz — `BILLING_CRON_SECRET` ile korumalı.
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    return NextResponse.json({ ok: true, ...(await runRecurring({ userIp: clientIpFrom(request) })) })
  } catch (error) {
    console.error("billing recurring run error:", error)
    return NextResponse.json({ error: "Recurring çalıştırılamadı" }, { status: 500 })
  }
}
