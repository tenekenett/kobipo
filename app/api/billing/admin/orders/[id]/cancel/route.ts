import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { prisma } from "@/lib/db/prisma"

export const dynamic = "force-dynamic"

/**
 * Yarıda kalmış bir paket siparişini iptal eder (PENDING_PAYMENT / FAILED → CANCELLED).
 * Aktif (ödenmiş) sipariş iptal edilemez. Süper-admin korumalı.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  const { id } = await params
  const order = await prisma.packageOrder.findUnique({ where: { id }, select: { id: true, status: true } })
  if (!order) return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 })
  if (order.status === "ACTIVE") {
    return NextResponse.json({ error: "Aktif (ödenmiş) sipariş iptal edilemez" }, { status: 409 })
  }
  if (order.status === "CANCELLED") return NextResponse.json({ ok: true })

  await prisma.packageOrder.update({ where: { id }, data: { status: "CANCELLED" } })
  return NextResponse.json({ ok: true })
}
