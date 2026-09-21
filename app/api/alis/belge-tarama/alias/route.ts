/**
 * Cari ürün eşleşmesi (öğrenen harita) — plan §3.5.
 *
 *   GET  ?companyId&cariId&keys=k1|k2   → { k1: productId, ... }
 *   POST { companyId, cariId, cariKind, eslesmeler: [{ key, label, productId }] }
 *        → onay kartında yapılan eşlemeleri yazar (upsert); kayıt anında çağrılır.
 *
 * Anahtar üretimi istemcide ve sunucuda AYNI saf modülden (eslestir/alias.ts).
 */

import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { withApiErrors } from "@/lib/api/errors"
import { assertOwnedByCompany } from "@/lib/company/owned"
import { prisma } from "@/lib/db/prisma"

export const dynamic = "force-dynamic"

export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const sp = new URL(request.url).searchParams
  const companyId = await resolveCompanyId(sp.get("companyId"))
  const cariId = sp.get("cariId")
  if (!companyId || !cariId) return NextResponse.json({ error: "companyId ve cariId zorunlu" }, { status: 400 })
  await ensureCompanyAccess(companyId)
  const keys = (sp.get("keys") || "").split("|").map((k) => k.trim()).filter(Boolean).slice(0, 500)
  if (keys.length === 0) return NextResponse.json({})
  const rows = await prisma.cariProductAlias.findMany({
    where: { companyId, cariId, key: { in: keys } },
    select: { key: true, productId: true },
  })
  return NextResponse.json(Object.fromEntries(rows.map((r) => [r.key, r.productId])))
})

export const POST = withApiErrors(async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const companyId = await resolveCompanyId(body?.companyId)
  const cariId = typeof body?.cariId === "string" ? body.cariId : ""
  const cariKind = body?.cariKind === "CUSTOMER" ? "CUSTOMER" : "SUPPLIER"
  const eslesmeler: Array<{ key: string; label?: string; productId: string }> = Array.isArray(body?.eslesmeler) ? body.eslesmeler : []
  if (!companyId || !cariId) return NextResponse.json({ error: "companyId ve cariId zorunlu" }, { status: 400 })
  await ensureCompanyWrite(companyId)

  const temiz = eslesmeler
    .filter((e) => e && typeof e.key === "string" && e.key.trim() && typeof e.productId === "string" && e.productId)
    .slice(0, 200)
  if (temiz.length === 0) return NextResponse.json({ yazilan: 0 })

  // Sahiplik: cari ve ürünler bu firmanın olmalı (başka firmanın ürününe alias yazılmaz).
  await assertOwnedByCompany(companyId, {
    ...(cariKind === "SUPPLIER" ? { supplier: cariId } : { customer: cariId }),
    product: temiz.map((e) => e.productId),
  })

  let yazilan = 0
  for (const e of temiz) {
    await prisma.cariProductAlias.upsert({
      where: { companyId_cariId_key: { companyId, cariId, key: e.key.trim() } },
      create: { companyId, cariId, cariKind, key: e.key.trim(), label: e.label?.trim() || null, productId: e.productId },
      update: { productId: e.productId, label: e.label?.trim() || undefined, lastSeenAt: new Date(), hitCount: { increment: 1 } },
    })
    yazilan++
  }
  return NextResponse.json({ yazilan })
})
