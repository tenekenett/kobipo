import { NextRequest, NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { prisma } from "@/lib/db/prisma"

export const dynamic = "force-dynamic"

/** PUT — paketi güncelle, DELETE — paketi sil (sadece sistem-admin). */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error
  const { id } = await params

  try {
    const existing = await prisma.kontorPackage.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: "Paket bulunamadı" }, { status: 404 })

    const body = await request.json()
    const data: Record<string, unknown> = {}
    if (body?.name != null) data.name = String(body.name).trim()
    if (body?.description !== undefined)
      data.description = body.description ? String(body.description).trim() : null
    if (body?.creditQty != null) {
      const q = Number(body.creditQty)
      if (!Number.isInteger(q) || q <= 0)
        return NextResponse.json({ error: "Kontör adedi geçersiz" }, { status: 400 })
      data.creditQty = q
    }
    if (body?.price != null) {
      const p = Number(body.price)
      if (!Number.isFinite(p) || p < 0)
        return NextResponse.json({ error: "Fiyat geçersiz" }, { status: 400 })
      data.price = p
    }
    if (body?.currency != null) data.currency = String(body.currency).trim()
    if (body?.mysoftTariffCode != null) {
      const code = String(body.mysoftTariffCode).trim()
      if (!code) return NextResponse.json({ error: "Tarife kodu boş olamaz" }, { status: 400 })
      data.mysoftTariffCode = code
    }
    if (body?.validityMonths !== undefined)
      data.validityMonths =
        body.validityMonths != null && Number.isFinite(Number(body.validityMonths))
          ? Number(body.validityMonths)
          : null
    if (body?.isActive != null) data.isActive = Boolean(body.isActive)
    if (body?.sortOrder != null && Number.isInteger(Number(body.sortOrder)))
      data.sortOrder = Number(body.sortOrder)

    const updated = await prisma.kontorPackage.update({ where: { id }, data })
    return NextResponse.json(updated)
  } catch (error: any) {
    console.error("kontor package PUT error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error
  const { id } = await params

  try {
    const existing = await prisma.kontorPackage.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: "Paket bulunamadı" }, { status: 404 })
    await prisma.kontorPackage.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("kontor package DELETE error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}
