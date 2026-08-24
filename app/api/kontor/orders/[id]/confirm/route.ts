import { NextRequest, NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { prisma } from "@/lib/db/prisma"
import { loadKontorOrderCredit } from "@/lib/kontor/fulfill"
import { issueInvoiceQuietly } from "@/lib/invoicing/issue-sales-invoice"
import { voidSalesInvoiceForOrder } from "@/lib/invoicing/void-sales-invoice"

export const dynamic = "force-dynamic"

/**
 * Sistem-admin sipariş onayı.
 *   action: "approve" (varsayılan) → ödemeyi onayla + bayi kimliğiyle Mysoft'a kontör yükle (insertDocumentCredit)
 *   action: "reject" → siparişi reddet
 *
 * Yükleme mantığı paylaşımlı helper'dadır ([[lib/kontor/fulfill.ts]]) — aynı kod PayTR
 * callback'inde de kullanılır. LOADED tekrar yüklenmez (çift yükleme koruması).
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
      // Red = satış olmayacak. Daha önce fatura kesildiyse (havale onaylanmış ama
      // sonradan geri çekilmiş, chargeback vb.) belge de geri alınmalı. Sonuç
      // yanıtta taşınır: e-Fatura ya da 24 saati geçmiş e-Arşiv otomatik iptal
      // edilemez, o durumda admin'e iade faturası talimatı döner.
      const voided = await voidSalesInvoiceForOrder({
        kind: "KONTOR",
        orderId: id,
        reason: "Sipariş sistem-admin tarafından reddedildi",
        userId: auth.user.id,
      })

      const rejected = await prisma.kontorOrder.update({
        where: { id },
        data: { status: "REJECTED", confirmedById: auth.user.id, confirmedAt: new Date() },
      })
      return NextResponse.json({
        ...rejected,
        invoiceVoid: voided.ok
          ? { ok: true, action: voided.action }
          : {
              ok: false,
              needsManual: voided.needsManual,
              message: voided.needsManual ? voided.instruction : voided.error,
            },
      })
    }

    // approve → Mysoft'a yükle (paylaşımlı helper)
    const res = await loadKontorOrderCredit(id, { confirmedById: auth.user.id })
    if (!res.ok) {
      return NextResponse.json({ error: res.error, order: res.order }, { status: res.status })
    }

    // Havale onaylandı = para tahsil edildi → satış faturası. Fırlatmaz; belge
    // kesilemezse sipariş yine de onaylı kalır, hata siparişin invoiceError'ına yazılır.
    await issueInvoiceQuietly({ kind: "KONTOR", orderId: id })

    // Fatura alanları güncellenmiş olabilir; taze kaydı dön.
    const fresh = await prisma.kontorOrder.findUnique({ where: { id } })
    return NextResponse.json(fresh ?? res.order)
  } catch (error: any) {
    console.error("kontor order confirm error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}
