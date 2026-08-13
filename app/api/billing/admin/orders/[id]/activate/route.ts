import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { activatePackageOrderManually } from "@/lib/billing/paytr-payment"

export const dynamic = "force-dynamic"

/**
 * Ödemesi alınmış ama bildirimi ulaşmamış bir paket siparişini elle aktifleştirir
 * (PENDING_PAYMENT / FAILED → ACTIVE). Süper-admin korumalı.
 *
 * KULLANIM ŞARTI: ödemenin gerçekten alındığı PayTR panelinden teyit edilmiş olmalı —
 * bu uç PayTR'a sormaz, doğrudan aboneliği uygular. İptal için kardeş uç: `.../cancel`.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  const { id } = await params
  try {
    const order = await activatePackageOrderManually(id)
    return NextResponse.json({ ok: true, order })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : "Sipariş aktifleştirilemedi"
    const status = message === "Sipariş bulunamadı" ? 404 : 500
    if (status === 500) console.error("billing admin order activate error:", error)
    return NextResponse.json({ error: message }, { status })
  }
}
