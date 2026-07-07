import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { prisma } from "@/lib/db/prisma"
import { ensureDefaultPricingItems } from "@/lib/billing/catalog"
import { BRANCH_ITEM_KEY, moduleKeyFromPriceKey } from "@/lib/billing/constants"
import { MODULE_KEYS } from "@/lib/modules"

export const dynamic = "force-dynamic"

/** Bir fiyat öğesi anahtarı geçerli mi? (module:<bilinenModül> veya "branch") */
function isValidItemKey(key: string): boolean {
  if (key === BRANCH_ITEM_KEY) return true
  const mk = moduleKeyFromPriceKey(key)
  return !!mk && (MODULE_KEYS as string[]).includes(mk)
}

/**
 * À la carte tekil fiyatlar (her modül + ek şube).
 * GET  — aktif öğeler herkese; ?all=1 (süper admin) pasifler dahil. Varsayılanları tohumlar.
 * PUT  — fiyatları toplu günceller (süper admin).
 */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const wantAll = new URL(request.url).searchParams.get("all") === "1"
  let includeInactive = false
  if (wantAll) {
    const auth = await requireSuperAdmin()
    if ("error" in auth) return auth.error
    includeInactive = true
  }

  await ensureDefaultPricingItems()
  const items = await prisma.pricingItem.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { sortOrder: "asc" },
  })
  return NextResponse.json({ data: items })
}

export async function PUT(request: Request) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  try {
    const body = await request.json()
    const items = Array.isArray(body?.items) ? body.items : []
    if (items.length === 0) {
      return NextResponse.json({ error: "Güncellenecek öğe yok" }, { status: 400 })
    }

    const ops = []
    for (const raw of items) {
      const key = String(raw?.key ?? "").trim()
      if (!isValidItemKey(key)) {
        return NextResponse.json({ error: `Geçersiz fiyat anahtarı: ${key}` }, { status: 400 })
      }
      const monthlyPrice = Number(raw?.monthlyPrice)
      const yearlyPrice = Number(raw?.yearlyPrice)
      if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0) {
        return NextResponse.json({ error: `Aylık fiyat geçersiz: ${key}` }, { status: 400 })
      }
      if (!Number.isFinite(yearlyPrice) || yearlyPrice < 0) {
        return NextResponse.json({ error: `Yıllık fiyat geçersiz: ${key}` }, { status: 400 })
      }
      const isActive = raw?.isActive == null ? true : Boolean(raw.isActive)
      const label = raw?.label ? String(raw.label).trim() : undefined

      ops.push(
        prisma.pricingItem.update({
          where: { key },
          data: { monthlyPrice, yearlyPrice, isActive, ...(label ? { label } : {}) },
        }),
      )
    }

    await prisma.$transaction(ops)
    const updated = await prisma.pricingItem.findMany({ orderBy: { sortOrder: "asc" } })
    return NextResponse.json({ data: updated })
  } catch (error: any) {
    console.error("billing pricing PUT error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}
