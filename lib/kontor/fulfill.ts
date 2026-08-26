import type { KontorOrder } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { recordDiscountRedemption } from "@/lib/billing/discount"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import {
  createPartnerProvider,
  PARTNER_NOT_CONFIGURED_ERROR,
} from "@/lib/integrations/e-invoice/partner"

export type LoadCreditResult =
  | { ok: true; order: KontorOrder; alreadyLoaded?: boolean }
  | { ok: false; error: string; status: number; order?: KontorOrder }

/**
 * Bir kontör siparişini bayi (İş Ortağı) kimliğiyle Mysoft'a yükler
 * (insertDocumentCredit), sipariş durumunu ve SystemLog'u günceller.
 *
 * Oturumsuz çağrılabilir (PayTR callback) — kimlik doğrulaması/yetki ÇAĞIRANIN
 * sorumluluğundadır. Hem sistem-admin onay route'u hem de PayTR callback bunu kullanır.
 * `LOADED` ise tekrar yüklemez (çift-yükleme koruması).
 */
export async function loadKontorOrderCredit(
  orderId: string,
  { confirmedById = null }: { confirmedById?: string | null } = {},
): Promise<LoadCreditResult> {
  const order = await prisma.kontorOrder.findUnique({ where: { id: orderId } })
  if (!order) return { ok: false, error: "Sipariş bulunamadı", status: 404 }
  if (order.status === "LOADED") return { ok: true, order, alreadyLoaded: true }

  /**
   * Siparişi FAILED'a çeker. Buraya YALNIZ ödemesi alınmış (callback) ya da admin'in
   * onayladığı sipariş gelir; bu yüzden yükleme neden başarısız olursa olsun durum
   * DEĞİŞMEDEN bırakılmaz: PENDING_PAYMENT'ta kalan bir sipariş müşteriye "ödeme
   * bekleniyor" gösterilir (üstelik callback idempotency'si tekrar denemez) → parası
   * alınmış sipariş ödenmemiş görünür. FAILED ise hem müşteri hem sistem-admin görür,
   * admin "Onayla" ile tekrar yükleyebilir.
   */
  const markFailed = async (reason: string, status: number): Promise<LoadCreditResult> => {
    const failed = await prisma.kontorOrder.update({
      where: { id: orderId },
      data: { status: "FAILED", loadError: reason, confirmedById, confirmedAt: new Date() },
    })
    return { ok: false, error: reason, status, order: failed }
  }

  let provider
  try {
    assertEInvoiceRuntimeReady()
    provider = createPartnerProvider()
  } catch (e: any) {
    return markFailed(e?.message || "E-Dönüşüm çalışma zamanı hazır değil", 503)
  }
  if (!provider) return markFailed(PARTNER_NOT_CONFIGURED_ERROR, 400)

  let result: { success: boolean; creditId?: number; error?: string }
  try {
    result = await provider.loadCredit({
      identifierNumber: order.targetVkn,
      tariffCode: order.mysoftTariffCode,
      creditQty: order.creditQty,
      note: `Kobipo kontör siparişi ${order.id}`,
    })
  } catch (e: any) {
    result = { success: false, error: e?.message || "Mysoft yükleme hatası" }
  }

  if (!result.success) {
    return markFailed(result.error || "Mysoft yüklemesi başarısız", 502)
  }

  const loaded = await prisma.kontorOrder.update({
    where: { id: orderId },
    data: {
      status: "LOADED",
      mysoftCreditId: result.creditId != null ? String(result.creditId) : null,
      loadError: null,
      confirmedById,
      confirmedAt: new Date(),
    },
  })

  // İNDİRİM KULLANIMI — satış BURADA kesinleşir (para alındı + kontör yüklendi).
  // Sipariş açılırken yazmıyoruz: yarım kalan sipariş kupon hakkını yemesin.
  // Idempotent (sipariş başına tek satır), tekrar gelen callback sayacı şişirmez.
  if (loaded.discountCodeId) {
    await recordDiscountRedemption({
      codeId: loaded.discountCodeId,
      companyId: loaded.companyId,
      orderKind: "KONTOR",
      orderId: loaded.id,
      amount: Number(loaded.discountAmount),
    })
  }

  await prisma.systemLog.create({
    data: {
      userId: confirmedById,
      action: "KONTOR_LOAD",
      entity: "KontorOrder",
      details: `Sipariş ${order.id}: ${order.creditQty} kontör → VKN ${order.targetVkn} (tarife ${order.mysoftTariffCode}, Mysoft id ${result.creditId ?? "?"})`,
      level: "INFO",
    },
  })

  return { ok: true, order: loaded }
}
