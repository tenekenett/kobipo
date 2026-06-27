import { NextRequest, NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { prisma } from "@/lib/db/prisma"
import { loadKontorOrderCredit } from "@/lib/kontor/fulfill"

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
      const rejected = await prisma.kontorOrder.update({
        where: { id },
        data: { status: "REJECTED", confirmedById: auth.user.id, confirmedAt: new Date() },
      })
      return NextResponse.json(rejected)
    }

    // approve → Mysoft'a yükle (paylaşımlı helper)
    const res = await loadKontorOrderCredit(id, { confirmedById: auth.user.id })
    if (!res.ok) {
      return NextResponse.json({ error: res.error, order: res.order }, { status: res.status })
    }
    return NextResponse.json(res.order)
  } catch (error: any) {
    console.error("kontor order confirm error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}
