import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { prisma } from "@/lib/db/prisma"
import { parseDiscountCodeInput } from "@/lib/billing/discount-input"

export const dynamic = "force-dynamic"

/** PUT — kodu güncelle, DELETE — kodu sil (yalnız sistem-admin). */
export async function PUT(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error
  const { id } = await params

  try {
    const existing = await prisma.discountCode.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: "Kod bulunamadı" }, { status: 404 })

    const body = await _request.json()
    const parsed = parseDiscountCodeInput(body, { requireAll: false })
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

    // KOD METNİ DEĞİŞTİRİLMEZ: kod siparişlere snapshot olarak yazılıyor ve müşteriye
    // duyurulmuş oluyor. Değiştirmek gerekiyorsa yenisi açılıp eskisi pasife alınır.
    const updated = await prisma.discountCode.update({ where: { id }, data: parsed.data })
    return NextResponse.json(updated)
  } catch (error: any) {
    console.error("discount-codes PUT error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error
  const { id } = await params

  try {
    const used = await prisma.discountCodeRedemption.count({ where: { codeId: id } })
    if (used > 0) {
      // Kullanılmış kod SİLİNMEZ: kullanım kayıtları hangi kampanyanın ne kadar
      // indirim yaptığının tek kaydı ve siparişlere bağlı. Pasife almak yeter.
      return NextResponse.json(
        {
          error: `Bu kod ${used} kez kullanılmış, silinemez. Kullanımı durdurmak için pasife alın.`,
        },
        { status: 409 },
      )
    }
    await prisma.discountCode.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error("discount-codes DELETE error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}
