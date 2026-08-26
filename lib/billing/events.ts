// Abonelik olay günlüğü — "ne zaman, neyin sonucu olarak oldu" sorusunun TEK cevabı.
//
// Neden var: `Subscription.status` yalnız SON hâli tutar, geçişi tutmaz. Bu projede
// hesapların modülleri canlıda İKİ KEZ sessizce kapandı (docs/paket-abonelik/ILERLEME.md
// — 2026-08-15'te kota-only sipariş `applyEntitlements(root, [])` çağırdı, ve elle
// verilen grant'lar `purchasedModules`a yazılmadığı için ilk yeniden hesaplamada silindi).
// Her ikisinde de müşteri "modüllerim kapandı" dediğinde bakılacak bir yer yoktu.
//
// Günlük APPEND-ONLY'dir: güncellenmez, silinmez. Bir kaydı "düzeltmek" gerekiyorsa
// yeni bir olay yazılır.

import { prisma } from "@/lib/db/prisma"
import type { Prisma } from "@prisma/client"

/**
 * Olay türleri. Yeni tür eklerken: müşteriye gösterilen abonelik geçmişi bu birlikten
 * okunur, o yüzden `EVENT_LABELS`a da satır eklenmeli.
 */
export type SubscriptionEventType =
  /** Yeni ödenmiş dönem başladı (ilk satın alma ya da yükseltme). */
  | "PERIOD_STARTED"
  /** Saklı kartla yinelenen çekim başarılı; dönem uzatıldı. */
  | "RENEWED"
  /** Yinelenen çekim reddedildi/başarısız. Hoşgörü sürüyor olabilir. */
  | "RENEWAL_FAILED"
  /** Dönem bitti, ödeme alınamadı → hoşgörü başladı. Modüller HÂLÂ AÇIK. */
  | "GRACE_STARTED"
  /** Hoşgörü doldu (ya da iptal edilmiş abonelik bitti) → modüller kilitlendi. */
  | "EXPIRED"
  /** Kilitten sonra saklama süresi doldu → hesap salt-okunur arşive alındı. */
  | "ARCHIVED"
  /** Müşteri dönem sonunda iptali seçti. Erişim `periodEnd`'e kadar sürer. */
  | "CANCELLED"
  /** Açık modül kümesi değişti (satın alma, düşürme ya da elle müdahale). */
  | "MODULES_CHANGED"
  /** Şube ve/veya ek firma kotası değişti. */
  | "QUOTA_CHANGED"
  /** Sistem yöneticisi elle süre verdi/uzattı. */
  | "MANUAL_GRANT"

/** Olayı KİMİN ürettiği. Elle müdahaleyi otomatik akıştan ayırmak için şart. */
export type SubscriptionActor = "SYSTEM" | "PAYTR" | "ADMIN" | "USER"

export const EVENT_LABELS: Record<SubscriptionEventType, string> = {
  PERIOD_STARTED: "Dönem başladı",
  RENEWED: "Otomatik yenilendi",
  RENEWAL_FAILED: "Yenileme başarısız",
  GRACE_STARTED: "Ödeme bekleniyor",
  EXPIRED: "Süresi doldu",
  ARCHIVED: "Arşive alındı",
  CANCELLED: "İptal edildi",
  MODULES_CHANGED: "Modüller değişti",
  QUOTA_CHANGED: "Kota değişti",
  MANUAL_GRANT: "Elle süre verildi",
}

export type SubscriptionEventInput = {
  type: SubscriptionEventType
  /** Hesabın KÖK firması. Abonelik satırı olmasa bile olay bir hesaba aittir. */
  companyId: string
  /** İnsan okuru için tek satır özet ("Yıllık dönem 27.08.2027'ye uzatıldı"). */
  summary: string
  subscriptionId?: string | null
  /** Önceki/sonraki durum, tutar, modül farkı… Sorguya değil OKUMAYA hizmet eder. */
  detail?: Prisma.InputJsonValue | null
  actor?: SubscriptionActor
  actorUserId?: string | null
}

/**
 * Bir olayı günlüğe yazar.
 *
 * **Asla fırlatmaz.** Günlük gözlem katmanıdır: yazılamaması, çağıran iş kuralının
 * (dönem uzatma, kilitleme, ödeme) yarıda kalmasına sebep OLMAMALI — aksi halde
 * gözlem aracının kendisi bir kesinti kaynağı olurdu.
 *
 * Ama SESSİZ de geçmez: hata `console.error` ile bağırır. Yutulan hataya bu projede
 * tolerans yok; günlüğün çalışmadığını fark etmemek, günlüğün hiç olmamasından kötüdür
 * (varlığına güvenip bakmayı bırakırsınız).
 */
export async function logSubscriptionEvent(input: SubscriptionEventInput): Promise<void> {
  try {
    await prisma.subscriptionEvent.create({
      data: {
        type: input.type,
        companyId: input.companyId,
        summary: input.summary,
        subscriptionId: input.subscriptionId ?? null,
        detail: input.detail ?? undefined,
        actor: input.actor ?? "SYSTEM",
        actorUserId: input.actorUserId ?? null,
      },
    })
  } catch (error) {
    console.error(
      `[subscription-event] YAZILAMADI (type=${input.type} company=${input.companyId}): ${input.summary}`,
      error,
    )
  }
}

/**
 * Toplu yazım — günlük iş tek koşuda onlarca aboneliğe dokunabilir, her biri için ayrı
 * INSERT turu atmak gereksiz.
 *
 * `createMany` kısmi başarı bildirmez; bu yüzden hata hâlinde kaç olayın kaybolduğu
 * loglanır. Boş liste sessizce geçer.
 */
export async function logSubscriptionEvents(inputs: SubscriptionEventInput[]): Promise<void> {
  if (inputs.length === 0) return
  try {
    await prisma.subscriptionEvent.createMany({
      data: inputs.map((input) => ({
        type: input.type,
        companyId: input.companyId,
        summary: input.summary,
        subscriptionId: input.subscriptionId ?? null,
        detail: input.detail ?? undefined,
        actor: input.actor ?? "SYSTEM",
        actorUserId: input.actorUserId ?? null,
      })),
    })
  } catch (error) {
    console.error(`[subscription-event] ${inputs.length} olay YAZILAMADI:`, error)
  }
}

/** Olay geçmişini okur (müşteri ekranı ve sistem-admin firma detayı). */
export async function getSubscriptionEvents(companyId: string, limit = 20) {
  return prisma.subscriptionEvent.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(1, limit), 100),
    select: {
      id: true,
      type: true,
      summary: true,
      detail: true,
      actor: true,
      createdAt: true,
    },
  })
}

/** Tarihi olay özetlerinde kullanılan tek biçime çevirir (27.08.2027). */
export function eventDate(d: Date | null | undefined): string {
  if (!d) return "—"
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" })
}
