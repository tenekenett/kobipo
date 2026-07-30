import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import {
  assertRestaurantModule,
  normalizeOptionInput,
  optionGroupInclude,
  serializeOptionGroup,
} from "@/lib/restoran/product-options"

export const dynamic = "force-dynamic"

// Ürün seçenekleri (porsiyon / modifier) — "Boy", "Süt", "Ekstra" grupları ve
// altındaki şıklar. Kararlar: docs/restoran/SATIS-EKRANI.md K6.
//
// Satış ekranı bu ucu ürün başına DEĞİL, firma başına bir kez çağırır: seçeneği
// olan ürünler azdır, her dokunuşta ağ turu atmak kasiyeri yavaşlatırdı — ve
// seçenek diyaloğunun anında açılması bu ekranın tek performans şartı.

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyAccess(companyId))

    const productId = searchParams.get("productId")?.trim()

    const groups = await prisma.productOptionGroup.findMany({
      where: { companyId, ...(productId ? { productId } : {}) },
      orderBy: [{ productId: "asc" }, { order: "asc" }, { createdAt: "asc" }],
      include: optionGroupInclude,
    })

    return NextResponse.json(groups.map(serializeOptionGroup))
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Error fetching product options:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** Seçenek grubunu şıklarıyla BİRLİKTE oluşturur — şıksız grup anlamsız. */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const productId = String(body.productId || "").trim()
    if (!productId) return NextResponse.json({ error: "Ürün zorunlu" }, { status: 400 })

    const product = await prisma.product.findFirst({ where: { id: productId, companyId } })
    if (!product) return NextResponse.json({ error: "Ürün bulunamadı" }, { status: 404 })

    const name = String(body.name || "").trim()
    if (!name) return NextResponse.json({ error: "Grup adı zorunlu" }, { status: 400 })

    const options = normalizeOptionInput(body.options)
    if (options.length === 0) {
      return NextResponse.json({ error: "En az bir seçenek gerekli" }, { status: 400 })
    }

    const last = await prisma.productOptionGroup.findFirst({
      where: { productId },
      orderBy: { order: "desc" },
      select: { order: true },
    })

    const group = await prisma.productOptionGroup.create({
      data: {
        companyId,
        productId,
        name: name.slice(0, 80),
        isRequired: body.isRequired === true,
        isMulti: body.isMulti === true,
        order: (last?.order ?? -1) + 1,
        options: { create: options },
      },
      include: optionGroupInclude,
    })

    return NextResponse.json(serializeOptionGroup(group), { status: 201 })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Error creating product option group:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
