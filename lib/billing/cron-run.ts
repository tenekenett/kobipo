// Günlük bakım işinin koşum kaydı — GÖZLEM + ÇİFT KOŞUM KİLİDİ.
//
// Neden gerekli: `/api/billing/cron/daily` kilitleme yapıyor. Sessizce üç gün
// çalışmazsa bugün kimse fark etmez — süresi dolan hesaplar açık kalır, uyarı
// e-postaları gitmez, yenileme çekilmez. Zamanlayıcının "çalıştım" demesi de yetmez;
// koşumun kendisi kayda geçmedikçe "en son ne zaman koştu" sorusunun cevabı yok.
//
// Kilit neden aynı yerde: iki kez tetiklenen bir koşum (zamanlayıcı yeniden denemesi,
// elle çağırma, iki bölge) uyarı e-postasını ikiler ve tahsilat isteğini tekrarlar.
// Kilit ile gözlem aynı kaydın iki yüzü olduğu için tek tabloda tutuluyor.

import { prisma } from "@/lib/db/prisma"
import { sendEmailBatch } from "@/lib/email/resend"

/** Koşum anahtarının gün parçası — UTC değil YEREL gün (cron da yerel saatte kurulu). */
export function cronDayKey(now: Date): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export type CronRunStart =
  | { started: true; id: string; jobKey: string }
  /** Bugün zaten koşmuş — çağıran HİÇBİR ŞEY YAPMADAN dönmeli. */
  | { started: false; jobKey: string; reason: "already_ran"; previous: { status: string; startedAt: Date } }

/**
 * Koşumu başlatır ve aynı gün ikinci koşumu engeller.
 *
 * Kilit yarışa dayanıklıdır: eşzamanlı iki istek de INSERT dener, `jobKey` benzersiz
 * olduğu için biri P2002 ile düşer. "Önce SELECT, sonra INSERT" yapsaydık iki isteğin
 * de boş görüp ikisinin de yazdığı pencere kalırdı.
 *
 * DİKKAT — takılı kalmış koşum: bir çalışma `RUNNING` iken süreç ölürse (timeout,
 * deploy) o günün kaydı `RUNNING` kalır ve aynı gün yeniden denenemez. Bu BİLİNÇLİ:
 * yarıda kalmış bir tahsilat turunu aynı gün körlemesine tekrarlamak, çift çekim
 * riskini kilidin engellediği riskten büyük yapar. Ertesi gün kendiliğinden düzelir;
 * acil durumda kayıt elle silinir.
 */
export async function startCronRun(job: string, now: Date = new Date()): Promise<CronRunStart> {
  const jobKey = `${job}:${cronDayKey(now)}`
  try {
    const run = await prisma.cronRun.create({
      data: { jobKey, job, startedAt: now, status: "RUNNING" },
      select: { id: true },
    })
    return { started: true, id: run.id, jobKey }
  } catch (error: any) {
    // P2002 = benzersiz kısıt ihlali → bugün zaten bir koşum var.
    if (error?.code !== "P2002") throw error
    const previous = await prisma.cronRun.findUnique({
      where: { jobKey },
      select: { status: true, startedAt: true },
    })
    return {
      started: false,
      jobKey,
      reason: "already_ran",
      previous: previous ?? { status: "UNKNOWN", startedAt: now },
    }
  }
}

/** Koşumu kapatır: süre, adım sonuçları ve başarısız adımlar kaydedilir. */
export async function finishCronRun(
  id: string,
  outcome: { result: unknown; failedSteps: string[]; startedAtMs: number },
): Promise<void> {
  const finishedAt = new Date()
  try {
    await prisma.cronRun.update({
      where: { id },
      data: {
        finishedAt,
        status: outcome.failedSteps.length > 0 ? "FAILED" : "OK",
        durationMs: finishedAt.getTime() - outcome.startedAtMs,
        result: (outcome.result ?? {}) as object,
        failedSteps: outcome.failedSteps,
      },
    })
  } catch (error) {
    // Kaydı kapatamamak işin kendisini geçersiz kılmaz; ama sessiz geçilmez.
    console.error(`[cron-run] koşum kaydı kapatılamadı (id=${id}):`, error)
  }
}

/**
 * Başarısız koşumu sistem yöneticilerine bildirir.
 *
 * Neden e-posta: bu iş erişim kesiyor ve para çekiyor. Bir adımı üç gün üst üste
 * patlarsa sonucu ya "ödeme yapan müşteri kilitlendi" ya da "ödemeyen müşteri açık
 * kaldı" olur; ikisi de log'a bakılmasını beklerken fark edilmez.
 *
 * Fırlatmaz: bildirim gönderilememesi, işin sonucunu değiştirmemeli.
 */
export async function alertCronFailure(params: {
  job: string
  jobKey: string
  failedSteps: string[]
  result: Record<string, unknown>
}): Promise<void> {
  try {
    const admins = await prisma.user.findMany({
      where: { isSuperAdmin: true, email: { not: "" } },
      select: { email: true },
    })
    if (admins.length === 0) {
      console.error(`[cron-run] ${params.jobKey} başarısız ama bildirilecek süper-admin yok`)
      return
    }

    // Ayrıntı gövdesi log'un aynısı: neyin patladığını görmek için panele girmek gerekmesin.
    const detail = JSON.stringify(params.result, null, 2)
    const subject = `Kobipo — günlük abonelik işi başarısız (${params.failedSteps.join(", ")})`
    const html = `
      <p><strong>${escapeHtml(params.jobKey)}</strong> koşumunda ${params.failedSteps.length} adım başarısız oldu:
      <strong>${escapeHtml(params.failedSteps.join(", "))}</strong>.</p>
      <p>Bu iş abonelik kilitleme ve yenileme tahsilatını yürütür; başarısız kalması
      ödeme yapan müşterinin kilitlenmesine ya da ödemeyenin açık kalmasına yol açar.</p>
      <pre style="background:#f6f7f9;padding:12px;border-radius:6px;overflow:auto;font-size:12px">${escapeHtml(detail)}</pre>
    `

    await sendEmailBatch(admins.map((a) => ({ to: a.email, subject, html })))
  } catch (error) {
    console.error("[cron-run] başarısızlık bildirimi gönderilemedi:", error)
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** Son koşumları okur — sistem-admin gözlem ekranı için. */
export async function getRecentCronRuns(job: string, limit = 14) {
  return prisma.cronRun.findMany({
    where: { job },
    orderBy: { startedAt: "desc" },
    take: Math.min(Math.max(1, limit), 60),
    select: {
      id: true,
      jobKey: true,
      startedAt: true,
      finishedAt: true,
      status: true,
      durationMs: true,
      failedSteps: true,
      result: true,
    },
  })
}
