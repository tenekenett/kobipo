import type { KontorOrder } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
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

  let provider
  try {
    assertEInvoiceRuntimeReady()
    provider = createPartnerProvider()
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message || "E-Dönüşüm çalışma zamanı hazır değil",
      status: 503,
      order,
    }
  }
  if (!provider) return { ok: false, error: PARTNER_NOT_CONFIGURED_ERROR, status: 400, order }

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
    const failed = await prisma.kontorOrder.update({
      where: { id: orderId },
      data: {
        status: "FAILED",
        loadError: result.error || "Mysoft yüklemesi başarısız",
        confirmedById,
        confirmedAt: new Date(),
      },
    })
    return {
      ok: false,
      error: result.error || "Mysoft yüklemesi başarısız",
      status: 502,
      order: failed,
    }
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
