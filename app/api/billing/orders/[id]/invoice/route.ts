import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { prisma } from "@/lib/db/prisma"
import { issueSalesInvoiceForOrder } from "@/lib/invoicing/issue-sales-invoice"
import { voidSalesInvoiceForOrder } from "@/lib/invoicing/void-sales-invoice"

export const dynamic = "force-dynamic"

/**
 * Paket/abonelik siparişi için sistem-admin fatura müdahalesi — kontör uçlarının
 * ([[app/api/kontor/orders/[id]/invoice]]) birebir eşi.
 *
 *   action: "issue" (varsayılan) → faturayı kes / kalınan yerden devam et
 *   action: "void"               → kesilmiş faturayı geri al
 *
 * "issue" idempotenttir ve kapılara TABİDİR: test siparişine elle tetikleyerek de
 * belge kestirilemez.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error
  const { id } = await params

  try {
    const body = await request.json().catch(() => ({}))
    const action = body?.action === "void" ? "void" : "issue"

    const order = await prisma.packageOrder.findUnique({ where: { id }, select: { id: true } })
    if (!order) return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 })

    if (action === "void") {
      const reason =
        typeof body?.reason === "string" && body.reason.trim()
          ? body.reason.trim()
          : "Sistem-admin faturayı geri aldı"
      const res = await voidSalesInvoiceForOrder({
        kind: "PACKAGE",
        orderId: id,
        reason,
        userId: auth.user.id,
      })
      if (!res.ok) {
        return NextResponse.json(
          { error: res.needsManual ? res.instruction : res.error, needsManual: res.needsManual },
          // needsManual sunucu hatası değil, mevzuat sınırı.
          { status: res.needsManual ? 409 : 502 },
        )
      }
      const fresh = await prisma.packageOrder.findUnique({ where: { id } })
      return NextResponse.json({ action: res.action, order: fresh })
    }

    const res = await issueSalesInvoiceForOrder({ kind: "PACKAGE", orderId: id })
    if (!res.ok) {
      return NextResponse.json(
        { error: res.skipped ? res.reason : res.error, skipped: res.skipped },
        { status: res.skipped ? 409 : 502 },
      )
    }
    const fresh = await prisma.packageOrder.findUnique({ where: { id } })
    return NextResponse.json({
      invoiceId: res.invoiceId,
      invoiceNo: res.invoiceNo,
      alreadyIssued: res.alreadyIssued,
      order: fresh,
    })
  } catch (error: any) {
    console.error("package order invoice action error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}
