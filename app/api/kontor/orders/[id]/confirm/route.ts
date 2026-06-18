import { NextRequest, NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { prisma } from "@/lib/db/prisma"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { createPartnerProvider, PARTNER_NOT_CONFIGURED_ERROR } from "@/lib/integrations/e-invoice/partner"

export const dynamic = "force-dynamic"

/**
 * Sistem-admin sipariş onayı.
 *   action: "approve" (varsayılan) → ödemeyi onayla + bayi kimliğiyle Mysoft'a kontör yükle (insertDocumentCredit)
 *   action: "reject" → siparişi reddet
 *
 * Yalnızca PENDING_PAYMENT / PAYMENT_REVIEW / FAILED durumundaki siparişler işlenebilir
 * (LOADED tekrar yüklenmez — çift yükleme koruması).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error
  const { id } = await params

  try {
    const body = await request.json().catch(() => ({}))
    const action = body?.action === "reject" ? "reject" : "approve"

    const order = await prisma.kontorOrder.findUnique({ where: { id } })
    if (!order) return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 })
    if (order.status === "LOADED") {
      return NextResponse.json({ error: "Sipariş zaten yüklenmiş" }, { status: 409 })
    }

    if (action === "reject") {
      const rejected = await prisma.kontorOrder.update({
        where: { id },
        data: { status: "REJECTED", confirmedById: auth.user.id, confirmedAt: new Date() },
      })
      return NextResponse.json(rejected)
    }

    // approve → Mysoft'a yükle
    assertEInvoiceRuntimeReady()
    const provider = createPartnerProvider()
    if (!provider) {
      return NextResponse.json({ error: PARTNER_NOT_CONFIGURED_ERROR }, { status: 400 })
    }

    const result = await provider.loadCredit({
      identifierNumber: order.targetVkn,
      tariffCode: order.mysoftTariffCode,
      creditQty: order.creditQty,
      note: `Kobipo kontör siparişi ${order.id}`,
    })

    if (!result.success) {
      const failed = await prisma.kontorOrder.update({
        where: { id },
        data: {
          status: "FAILED",
          loadError: result.error || "Mysoft yüklemesi başarısız",
          confirmedById: auth.user.id,
          confirmedAt: new Date(),
        },
      })
      return NextResponse.json(
        { error: result.error || "Mysoft yüklemesi başarısız", order: failed },
        { status: 502 },
      )
    }

    const loaded = await prisma.kontorOrder.update({
      where: { id },
      data: {
        status: "LOADED",
        mysoftCreditId: result.creditId != null ? String(result.creditId) : null,
        loadError: null,
        confirmedById: auth.user.id,
        confirmedAt: new Date(),
      },
    })

    await prisma.systemLog.create({
      data: {
        userId: auth.user.id,
        action: "KONTOR_LOAD",
        entity: "KontorOrder",
        details: `Sipariş ${order.id}: ${order.creditQty} kontör → VKN ${order.targetVkn} (tarife ${order.mysoftTariffCode}, Mysoft id ${result.creditId ?? "?"})`,
        level: "INFO",
      },
    })

    return NextResponse.json(loaded)
  } catch (error: any) {
    console.error("kontor order confirm error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}
