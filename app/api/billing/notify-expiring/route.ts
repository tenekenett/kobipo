import { NextResponse } from "next/server"
import { isCronAuthorized } from "@/lib/billing/cron-auth"
import { notifyExpiring } from "@/lib/billing/jobs"
import { resolveBaseUrl } from "@/lib/utils/base-url"

export const dynamic = "force-dynamic"

/**
 * Abonelik bitiş uyarısı gönderici. Hiçbir erişimi KESMEZ, hiçbir durumu değiştirmez;
 * yalnız e-posta atar. Kilitleme işi `/api/billing/reconcile`'ın.
 *
 * Mantık [[lib/billing/jobs.ts]] → `notifyExpiring`. Bu uç elle çalıştırma içindir;
 * günlük koşu `/api/billing/cron/daily` orkestratörü üzerinden yapılır.
 *
 * Eşikler (7/3/1 gün kala + bitiş günü) durum saklamadan çalışsın diye güne bağlı:
 * günde iki kez koşturulursa e-posta ikilenir.
 *
 * Oturumsuz — `BILLING_CRON_SECRET` ile korumalı.
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await notifyExpiring({ baseUrl: resolveBaseUrl(request) })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error("notify-expiring error:", error)
    return NextResponse.json({ error: "Uyarı gönderimi başarısız" }, { status: 500 })
  }
}
