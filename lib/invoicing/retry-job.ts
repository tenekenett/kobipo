// Faturasız kalmış ödenmiş siparişleri toparlayan günlük iş.
// Plan: docs/faturalandirma/PLAN.md (Faz 5)
//
// NEDEN GEREKLİ: fatura kesme, ödemenin yan işlemidir ve bilerek "sessiz" başarısız
// olur (PayTR bildirimini tekrarlatmamak için). Geçici bir Mysoft hatası, o an
// çözülemeyen bir alıcı VKN'si ya da kapalı bir kapı yüzünden faturasız kalan sipariş
// burada tekrar denenir. Fatura düzenleme süresi hizmetin ifasından itibaren 7 gündür;
// iş, o süreye YAKLAŞANLARI ayrıca raporlar ki insan müdahalesi zamanında olsun.

import { prisma } from "@/lib/db/prisma"
import {
  issueSalesInvoiceForOrder,
  reconcileOrderCollection,
} from "@/lib/invoicing/issue-sales-invoice"
import { autoInvoiceStartAt, isAutoInvoiceEnabled } from "@/lib/invoicing/config"

/** VUK 231/5: hizmetin ifasından itibaren 7 gün. */
const INVOICE_DEADLINE_DAYS = 7
/** Kaç gün kala "acil" sayılsın. */
const URGENT_WITHIN_DAYS = 2
/** Tek koşuda denenecek üst sınır — cron zaman aşımına girmesin. */
const MAX_PER_RUN = 25

export type InvoiceRetryResult = {
  skipped?: boolean
  reason?: string
  scanned: number
  issued: number
  failed: number
  /** Süresi dolmak üzere olan ya da dolmuş, hâlâ faturasız siparişler. */
  urgent: Array<{ kind: "KONTOR" | "PACKAGE"; orderId: string; daysLeft: number; error: string | null }>
  /** Cari kaydı sonradan tamamlanan sipariş sayısı. */
  reconciled?: number
}

const daysBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 86_400_000

/**
 * Ödenmiş ama faturalanmamış siparişleri tekrar dener.
 *
 * Kapılar servisin içinde olduğu için burada tekrar kontrol edilmez; yalnız iş hiç
 * çalışmasın diye ana şalter baştan bakılır (kapalıyken her gece 25 sipariş için
 * boşuna Mysoft'a gitmenin anlamı yok).
 */
export async function runInvoiceRetry(
  options: { now?: Date } = {},
): Promise<InvoiceRetryResult> {
  const now = options.now ?? new Date()

  if (!isAutoInvoiceEnabled()) {
    return { skipped: true, reason: "Otomatik faturalandırma kapalı", scanned: 0, issued: 0, failed: 0, urgent: [] }
  }
  const startAt = autoInvoiceStartAt()
  if (!startAt) {
    return {
      skipped: true,
      reason: "KOBIPO_AUTO_INVOICE_START_AT tanımsız",
      scanned: 0,
      issued: 0,
      failed: 0,
      urgent: [],
    }
  }

  // Faturasız, ödemesi alınmış, test olmayan ve faturalandırma başlangıcından SONRAKİ
  // siparişler. Kontörde ayrıca yükleme başarılı olmalı: hizmet ifa edilmediyse belge
  // kesilmez (bkz. lib/kontor/paytr-payment.ts).
  const [kontor, paket] = await Promise.all([
    prisma.kontorOrder.findMany({
      where: {
        invoiceId: null,
        isTest: false,
        status: "LOADED",
        OR: [{ paidAt: { gte: startAt } }, { paidAt: null, confirmedAt: { gte: startAt } }],
      },
      select: { id: true, paidAt: true, confirmedAt: true, invoiceError: true },
      orderBy: { createdAt: "asc" },
      take: MAX_PER_RUN,
    }),
    prisma.packageOrder.findMany({
      where: {
        invoiceId: null,
        isTest: false,
        status: "ACTIVE",
        paidAt: { gte: startAt },
      },
      select: { id: true, paidAt: true, invoiceError: true },
      orderBy: { createdAt: "asc" },
      take: MAX_PER_RUN,
    }),
  ])

  const queue: Array<{ kind: "KONTOR" | "PACKAGE"; id: string; paidAt: Date; error: string | null }> = [
    ...kontor.map((o) => ({
      kind: "KONTOR" as const,
      id: o.id,
      paidAt: o.paidAt ?? o.confirmedAt ?? now,
      error: o.invoiceError,
    })),
    ...paket.map((o) => ({
      kind: "PACKAGE" as const,
      id: o.id,
      paidAt: o.paidAt ?? now,
      error: o.invoiceError,
    })),
  ]

  let issued = 0
  let failed = 0
  const urgent: InvoiceRetryResult["urgent"] = []

  for (const item of queue) {
    const res = await issueSalesInvoiceForOrder({ kind: item.kind, orderId: item.id })
    if (res.ok) {
      issued++
      continue
    }
    failed++

    // Hâlâ faturasız: süre ne kadar kaldı?
    const daysLeft = INVOICE_DEADLINE_DAYS - daysBetween(item.paidAt, now)
    if (daysLeft <= URGENT_WITHIN_DAYS) {
      urgent.push({
        kind: item.kind,
        orderId: item.id,
        daysLeft: Math.round(daysLeft * 10) / 10,
        error: res.skipped ? res.reason : res.error,
      })
    }
  }

  if (urgent.length > 0) {
    // Log seviyesi bilinçli olarak WARNING: burada kalan her satır, süresi dolmadan
    // elle müdahale edilmezse usulsüzlük cezasına dönüşebilecek bir satıştır.
    console.warn(
      `[faturalandirma] Süresi yaklaşan faturasız sipariş: ${urgent
        .map((u) => `${u.kind}:${u.orderId} (${u.daysLeft} gün)`)
        .join(", ")}`,
    )
    await prisma.systemLog
      .create({
        data: {
          action: "SALES_INVOICE_OVERDUE",
          entity: "KontorOrder",
          details:
            `${urgent.length} sipariş faturasız ve 7 günlük düzenleme süresi doluyor: ` +
            urgent.map((u) => `${u.kind}:${u.orderId} (${u.daysLeft} gün, ${u.error ?? "-"})`).join(" | "),
          level: "WARNING",
        },
      })
      .catch(() => {})
  }

  const reconciled = await reconcilePendingCollections()

  return { scanned: queue.length, issued, failed, urgent, reconciled }
}

/**
 * Faturası kesilmiş ama cari kaydı eksik kalmış siparişleri tamamlar.
 *
 * Tahsilat hesabı tanımsızken kesilen faturalarda ödeme kaydı `transactionId`siz
 * yazılır ve cari borç açık kalır. Hesap sonradan env'e girildiğinde bu sweep
 * eksikleri kapatır — aksi halde o siparişler sonsuza dek elle düzeltme bekler.
 */
async function reconcilePendingCollections(): Promise<number> {
  const pending = await prisma.invoicePayment.findMany({
    where: { transactionId: null },
    select: {
      invoice: {
        select: { kontorOrder: { select: { id: true } }, packageOrder: { select: { id: true } } },
      },
    },
    take: MAX_PER_RUN,
  })

  let done = 0
  for (const p of pending) {
    const kontorId = p.invoice?.kontorOrder?.id
    const packageId = p.invoice?.packageOrder?.id
    // Kobipo'nun KENDİ satışı değilse (elle girilmiş bir fatura ödemesi) dokunma.
    if (!kontorId && !packageId) continue
    await reconcileOrderCollection(
      kontorId ? { kind: "KONTOR", orderId: kontorId } : { kind: "PACKAGE", orderId: packageId! },
    )
    done++
  }
  return done
}
