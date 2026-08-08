import { NextResponse } from "next/server"
import { isCronAuthorized } from "@/lib/billing/cron-auth"
import { runReconcile } from "@/lib/billing/jobs"

export const dynamic = "force-dynamic"

/**
 * Enforcement reconcile — süresi geçmiş abonelikleri önce hoşgörüye (`PAST_DUE`,
 * modüller AÇIK kalır), hoşgörü de dolunca `EXPIRED`'a çeker ve modülleri kilitler.
 *
 * Mantık [[lib/billing/jobs.ts]] → `runReconcile`; karar kuralı [[lib/billing/notice.ts]] →
 * `reconcileAction` (saf ve testli). Bu uç elle çalıştırma içindir; günlük koşu
 * `/api/billing/cron/daily` orkestratörü üzerinden yapılır ve SIRA oradadır
 * (notify → recurring → reconcile).
 *
 * Oturumsuz — `BILLING_CRON_SECRET` ile korunur ([[lib/billing/cron-auth.ts]]).
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    return NextResponse.json({ ok: true, ...(await runReconcile()) })
  } catch (error) {
    console.error("billing reconcile error:", error)
    return NextResponse.json({ error: "Reconcile başarısız" }, { status: 500 })
  }
}
