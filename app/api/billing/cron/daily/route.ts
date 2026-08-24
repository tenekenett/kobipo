import { NextResponse } from "next/server"
import { isCronAuthorized } from "@/lib/billing/cron-auth"
import { clientIpFrom, notifyExpiring, runRecurring, runReconcile } from "@/lib/billing/jobs"
import { runInvoiceRetry } from "@/lib/invoicing/retry-job"
import { resolveBaseUrl } from "@/lib/utils/base-url"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Günlük abonelik bakımı — TEK zamanlanan uç.
 *
 * Dört işi **sırayla** çalıştırır (sıra kritik, bkz. [[lib/billing/jobs.ts]]):
 *   1. uyarı e-postaları  → kimseye dokunmaz, önce uyarır
 *   2. yinelenen ödeme    → vadesi geleni çeker, başarılıysa dönemi uzatır
 *   3. uzlaştırma         → yenilenmeyeni hoşgörüye/kilide alır
 *   4. fatura toparlama   → faturasız kalmış ödenmiş siparişleri tekrar dener
 *
 * 4. adım EN SONDA: kendisi kimseye dokunmaz (yalnız belge keser) ve 2. adımda yeni
 * yenilenmiş bir dönem varsa onu da aynı koşuda yakalayabilsin.
 *
 * Sırayı cron yapılandırmasına bırakmak yerine burada tutmanın iki sebebi var: üç ayrı
 * cron girdisi arasında sıra/gecikme garantisi yoktur (2. adım gecikirse 3. adım yenilenmiş
 * aboneliği kilitler), ve çoğu barındırma planında cron sayısı sınırlıdır.
 *
 * **GET de kabul eder**: Vercel Cron zamanlanmış uçları GET ile çağırır. Her iki metotta da
 * `BILLING_CRON_SECRET` (ya da Vercel'in `CRON_SECRET`'ı) aranır — bkz. lib/billing/cron-auth.ts.
 *
 * Bir adımın hatası diğerlerini durdurmaz: sonuç gövdesinde adım adım raporlanır, böylece
 * e-posta sağlayıcısı çöktüğünde kilitleme yine de çalışır.
 */
async function handle(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const startedAt = Date.now()
  const steps: Record<string, unknown> = {}
  const errors: string[] = []

  const step = async (name: string, run: () => Promise<unknown>) => {
    try {
      steps[name] = await run()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`billing daily cron — ${name} başarısız:`, error)
      steps[name] = { error: message }
      errors.push(name)
    }
  }

  await step("notify", () => notifyExpiring({ baseUrl: resolveBaseUrl(request) }))
  await step("recurring", () => runRecurring({ userIp: clientIpFrom(request) }))
  await step("reconcile", () => runReconcile())
  await step("invoiceRetry", () => runInvoiceRetry())

  return NextResponse.json(
    {
      ok: errors.length === 0,
      failedSteps: errors.length > 0 ? errors : undefined,
      durationMs: Date.now() - startedAt,
      ...steps,
    },
    // Kısmi başarıda 500 dönmek zamanlayıcının "başarısız" işaretlemesi için doğru sinyal.
    { status: errors.length > 0 ? 500 : 200 }
  )
}

export const GET = handle
export const POST = handle
