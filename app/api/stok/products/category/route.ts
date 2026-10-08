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
 *
 * MARKA da buradan geçer (`field=brand`): aynı iki-yerde-yaşama modeli
 * (CompanyDefinition type=PRODUCT_BRAND + ürünün `brand` metni). Ayrı bir uç
 * açılsaydı sayfa kapısına (lib/page-access.ts) ikinci bir kural yazmak ve iki
 * kopyayı aynı tutmak gerekirdi.
 */

import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { prisma } from "@/lib/db/prisma"

export const dynamic = "force-dynamic"

/** Toplu işlemin dokunabileceği ürün alanları — gövdeden gelen ad DOĞRUDAN kolona gitmez. */
type GroupField = "category" | "brand"

function asGroupField(value: unknown): GroupField | null {
  if (value == null || value === "" || value === "category") return "category"
  if (value === "brand") return "brand"
  return null
}

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

    const field = asGroupField(searchParams.get("field"))
    if (!field) {
      return NextResponse.json({ error: "Geçersiz alan (field)" }, { status: 400 })
    }

    // Yanıt şekli alan ne olursa olsun `{ category, count }` — kategori
    // penceresinin mevcut okuyucusu kırılmasın diye anahtar adı korunuyor.
    const grouped =
      field === "brand"
        ? (
            await prisma.product.groupBy({
              by: ["brand"],
              where: { companyId, brand: { not: null } },
              _count: { _all: true },
            })
          ).map((g) => ({ value: g.brand, count: g._count._all }))
        : (
            await prisma.product.groupBy({
              by: ["category"],
              where: { companyId, category: { not: null } },
              _count: { _all: true },
            })
          ).map((g) => ({ value: g.category, count: g._count._all }))

    const counts = grouped
      .filter((g) => (g.value ?? "").trim())
      .map((g) => ({ category: (g.value as string).trim(), count: g.count }))
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

    const field = asGroupField(body.field)
    if (!field) {
      return NextResponse.json({ error: "Geçersiz alan (field)" }, { status: 400 })
    }

    const from = typeof body.from === "string" ? body.from.trim() : ""
    if (!from) {
      return NextResponse.json(
        { error: field === "brand" ? "Değiştirilecek marka (from) gerekli" : "Değiştirilecek kategori (from) gerekli" },
        { status: 400 }
      )
    }

    // `to` null/boş → kategoriyi boşalt. Boş metin DEĞİL null yazılır: ürün
    // listeleri ve sekmeler "kategorisiz"i null ile ayırt ediyor.
    const rawTo = body.to
    const to = typeof rawTo === "string" && rawTo.trim() ? rawTo.trim() : null

    const result =
      field === "brand"
        ? await prisma.product.updateMany({
            where: { companyId, brand: from },
            data: { brand: to },
          })
        : await prisma.product.updateMany({
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
