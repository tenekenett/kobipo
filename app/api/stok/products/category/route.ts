/**
 * Bir kategoriyi ürünler üzerinde TOPLU değiştirir/boşaltır.
 *
 * NEDEN AYRI BİR UÇ: kategori iki yerde yaşıyor — firma tanımı olarak
 * (CompanyDefinition type=PRODUCT_CATEGORY, yani öneri listesi) ve ürünün kendi
 * `category` metni olarak. Satış/adisyon ekranındaki kategori sekmeleri
 * ÜRÜNLERDEN üretiliyor, tanımlardan değil; dolayısıyla tanımı silmek sekmeyi
 * kaldırmıyordu. Kullanıcı "kategoriyi sildim ama hâlâ duruyor" diyordu.
 *
 * Tek `updateMany` ile yapılır: istemciden ürün ürün PATCH atmak 200 ürünlük bir
 * kategoride 200 istek ve yarım kalabilen bir temizlik demekti.
 *
 * Yol `/products/category`; `[id]` ile çakışmaz — Next.js statik segmenti
 * dinamik olana tercih eder.
 */

import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { prisma } from "@/lib/db/prisma"

export const dynamic = "force-dynamic"

/**
 * Kategori → kaç ürün. Sayım SUNUCUDA yapılır: Stok ekranındaki ürün listesi
 * arama kutusuna göre filtreli geliyor, oradan saymak arama açıkken yanlış
 * ("3 üründe kullanılıyor" derken aslında 40) sayı gösterirdi.
 */
export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    }
    await ensureCompanyAccess(companyId)

    const grouped = await prisma.product.groupBy({
      by: ["category"],
      where: { companyId, category: { not: null } },
      _count: { _all: true },
    })

    const counts = grouped
      .filter((g) => (g.category ?? "").trim())
      .map((g) => ({ category: (g.category as string).trim(), count: g._count._all }))
      .sort((a, b) => a.category.localeCompare(b.category, "tr-TR"))

    return NextResponse.json(counts)
  } catch (error: any) {
    if (typeof error?.message === "string" && error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error counting product categories:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PATCH = withApiErrors(async function PATCH(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: "Geçersiz istek gövdesi" }, { status: 400 })
    }

    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    }
    await ensureCompanyWrite(companyId)

    const from = typeof body.from === "string" ? body.from.trim() : ""
    if (!from) {
      return NextResponse.json({ error: "Değiştirilecek kategori (from) gerekli" }, { status: 400 })
    }

    // `to` null/boş → kategoriyi boşalt. Boş metin DEĞİL null yazılır: ürün
    // listeleri ve sekmeler "kategorisiz"i null ile ayırt ediyor.
    const rawTo = body.to
    const to = typeof rawTo === "string" && rawTo.trim() ? rawTo.trim() : null

    const result = await prisma.product.updateMany({
      where: { companyId, category: from },
      data: { category: to },
    })

    return NextResponse.json({ updated: result.count })
  } catch (error: any) {
    if (typeof error?.message === "string" && error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error updating product category:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
