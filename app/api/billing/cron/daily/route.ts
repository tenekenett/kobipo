import { NextResponse } from "next/server"
import { isCronAuthorized } from "@/lib/billing/cron-auth"
import { clientIpFrom, notifyExpiring, runRecurring, runReconcile } from "@/lib/billing/jobs"
import { alertCronFailure, finishCronRun, startCronRun } from "@/lib/billing/cron-run"
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
 * ZAMANLAMA: `vercel.json` → `crons`, her gün 06:00 UTC (TR ile 09:00). Bu girdi
 * eklenene kadar (2026-08-27) uç yazılıydı ama HİÇ ÇAĞRILMIYORDU: dönemi biten
 * abonelikler sonsuza kadar açık kalıyor, uyarı e-postaları hiç gitmiyordu.
 *
 * **Dağıtım uyarısı:** bu iş canlıda ilk kez koştuğunda, dönemi çoktan bitmiş hesaplar
 * hoşgörüye (`PAST_DUE`) ve ardından kilide (`EXPIRED`) yürümeye başlar. Yani ilk
 * dağıtım "enforcement'ı açmak"tır — öncesinde `BILLING_CRON_SECRET` tanımlı olmalı ve
 * otomatik yenilemenin (`PAYTR_RECURRING_ENABLED`) durumu bilinçli seçilmiş olmalıdır.
 *
 * Her koşum `cron_runs` tablosuna yazılır (gözlem + çift koşum kilidi) ve başarısız adım
 * süper-admin'lere e-postayla bildirilir — bkz. [[lib/billing/cron-run.ts]].
 *
 * Bir adımın hatası diğerlerini durdurmaz: sonuç gövdesinde adım adım raporlanır, böylece
 * e-posta sağlayıcısı çöktüğünde kilitleme yine de çalışır.
 */
export const CRON_JOB_NAME = "billing-daily"

async function handle(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = new Date()
  const startedAt = Date.now()

  // ÇİFT KOŞUM KİLİDİ — aynı gün ikinci tetikleme (zamanlayıcı yeniden denemesi, elle
  // çağırma, iki bölge) uyarı e-postasını ikiler ve tahsilat isteğini tekrarlar.
  // 200 dönülür: bu bir hata değil, "yapacak iş yok" durumudur; 500 dönmek zamanlayıcıyı
  // boşuna alarma geçirirdi.
  const run = await startCronRun(CRON_JOB_NAME, now)
  if (!run.started) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Bugün zaten koştu",
      jobKey: run.jobKey,
      previous: run.previous,
    })
  }

  const steps: Record<string, unknown> = {}
  const errors: string[] = []

  const step = async (name: string, task: () => Promise<unknown>) => {
    try {
      steps[name] = await task()
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

  await finishCronRun(run.id, { result: steps, failedSteps: errors, startedAtMs: startedAt })

  // Başarısız adım = sessizce yaşanmaması gereken bir şey: bu iş erişim kesiyor ve para
  // çekiyor. Bildirim gönderimi işin sonucunu etkilemez (fırlatmaz).
  if (errors.length > 0) {
    await alertCronFailure({
      job: CRON_JOB_NAME,
      jobKey: run.jobKey,
      failedSteps: errors,
      result: steps,
    })
  }

  return NextResponse.json(
    {
      ok: errors.length === 0,
      jobKey: run.jobKey,
      failedSteps: errors.length > 0 ? errors : undefined,
      durationMs: Date.now() - startedAt,
      ...steps,
    },
    // Kısmi başarıda 500 dönmek zamanlayıcının "başarısız" işaretlemesi için doğru sinyal.
    { status: errors.length > 0 ? 500 : 200 },
  )
}

export const GET = handle
export const POST = handle
