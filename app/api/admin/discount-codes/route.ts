import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { prisma } from "@/lib/db/prisma"
import { normalizeDiscountCode } from "@/lib/billing/discount"
import { parseDiscountCodeInput } from "@/lib/billing/discount-input"

export const dynamic = "force-dynamic"

/**
 * İndirim kodu yönetimi — YALNIZ sistem-admin.
 *
 * GET  — tüm kodlar + kullanım sayıları (panelde "3/50 kullanıldı" göstermek için).
 * POST — yeni kod.
 */
export async function GET() {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  const codes = await prisma.discountCode.findMany({
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    include: { _count: { select: { redemptions: true } } },
  })
  return NextResponse.json({
    data: codes.map(({ _count, ...c }) => ({ ...c, redemptionCount: _count.redemptions })),
  })
}

export async function POST(request: Request) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  try {
    const body = await request.json()
    const parsed = parseDiscountCodeInput(body, { requireAll: true })
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const code = normalizeDiscountCode(body?.code)
    if (!code) return NextResponse.json({ error: "Kod zorunlu" }, { status: 400 })
    if (code.length > 32) return NextResponse.json({ error: "Kod en fazla 32 karakter" }, { status: 400 })
    // Normalizasyon Türkçe harfleri ASCII'ye indirger; kalan her şey ASCII olmalı ki
    // müşterinin yazdığı ile kayıtlı kod HER ZAMAN aynı dizeye düşsün.
    if (!/^[A-Z0-9._-]+$/.test(code)) {
      return NextResponse.json(
        { error: "Kod yalnız harf, rakam ve . _ - içerebilir (Türkçe karakter otomatik çevrilir)" },
        { status: 400 },
      )
    }

    const exists = await prisma.discountCode.findUnique({ where: { code } })
    if (exists) return NextResponse.json({ error: "Bu kod zaten tanımlı" }, { status: 409 })

    const created = await prisma.discountCode.create({ data: { code, ...parsed.data } })
    return NextResponse.json(created)
  } catch (error: any) {
    console.error("discount-codes POST error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}
