import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { assertRestaurantModule } from "@/lib/restoran/tickets"
import { assertNoRecipeCycle, RecipeCycleError } from "@/lib/stock/recipe"
import { canConvert, normalizeUnitCode } from "@/lib/data/units"

export const dynamic = "force-dynamic"

const recipeSelect = {
  id: true,
  productId: true,
  yieldQuantity: true,
  isActive: true,
  note: true,
  updatedAt: true,
  product: { select: { id: true, name: true, unit: true, salePrice: true, isSellable: true } },
  items: {
    select: {
      id: true,
      componentProductId: true,
      quantity: true,
      unit: true,
      wastageRate: true,
      order: true,
      component: {
        select: { id: true, name: true, unit: true, purchasePrice: true, stockQuantity: true },
      },
    },
    orderBy: { order: "asc" as const },
  },
} as const

/** Decimal alanları sayıya çevirir; istemci tarafında string ile uğraşılmasın. */
function serialize(recipe: any) {
  return {
    id: recipe.id,
    productId: recipe.productId,
    yieldQuantity: Number(recipe.yieldQuantity),
    isActive: recipe.isActive,
    note: recipe.note,
    updatedAt: recipe.updatedAt,
    product: {
      id: recipe.product.id,
      name: recipe.product.name,
      unit: recipe.product.unit,
      isSellable: recipe.product.isSellable,
      salePrice: recipe.product.salePrice != null ? Number(recipe.product.salePrice) : null,
    },
    items: recipe.items.map((item: any) => ({
      id: item.id,
      componentProductId: item.componentProductId,
      quantity: Number(item.quantity),
      unit: item.unit,
      wastageRate: item.wastageRate != null ? Number(item.wastageRate) : null,
      order: item.order,
      component: {
        id: item.component.id,
        name: item.component.name,
        unit: item.component.unit,
        purchasePrice:
          item.component.purchasePrice != null ? Number(item.component.purchasePrice) : null,
        stockQuantity: Number(item.component.stockQuantity),
      },
    })),
  }
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    }

    assertRestaurantModule(await ensureCompanyAccess(companyId))

    const productId = searchParams.get("productId")?.trim() || undefined

    const recipes = await prisma.productRecipe.findMany({
      where: { companyId, ...(productId ? { productId } : {}) },
      select: recipeSelect,
      orderBy: { product: { name: "asc" } },
    })

    return NextResponse.json(recipes.map(serialize))
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching recipes:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Reçete oluşturur veya günceller (ürün başına tek reçete → upsert).
 * Kalemler tümüyle değiştirilir (delete + create), böylece istemci kısmi
 * senkronizasyon mantığı taşımak zorunda kalmaz.
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    }

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const productId = String(body.productId || "").trim()
    if (!productId) {
      return NextResponse.json({ error: "productId is required" }, { status: 400 })
    }

    const rawItems = Array.isArray(body.items) ? body.items : []
    const items = rawItems
      .map((item: any, index: number) => ({
        componentProductId: String(item?.componentProductId || "").trim(),
        quantity: Number(item?.quantity),
        unit: normalizeUnitCode(item?.unit),
        wastageRate:
          item?.wastageRate === "" || item?.wastageRate == null ? null : Number(item.wastageRate),
        order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index,
      }))
      .filter((item: any) => item.componentProductId)

    if (items.length === 0) {
      return NextResponse.json({ error: "Reçete en az bir bileşen içermeli" }, { status: 400 })
    }

    for (const item of items) {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        return NextResponse.json({ error: "Bileşen miktarı sıfırdan büyük olmalı" }, { status: 400 })
      }
      if (!item.unit) {
        return NextResponse.json({ error: "Bileşen birimi zorunlu" }, { status: 400 })
      }
    }

    const componentIds = items.map((i: any) => i.componentProductId)
    if (new Set(componentIds).size !== componentIds.length) {
      return NextResponse.json(
        { error: "Aynı bileşen birden fazla kez eklenemez" },
        { status: 400 }
      )
    }

    // Ürün ve bileşenlerin tümü BU firmaya ait olmalı (tenant sızıntısı önlemi).
    const involved = await prisma.product.findMany({
      where: { id: { in: Array.from(new Set([productId, ...componentIds])), }, companyId },
      select: { id: true, name: true, unit: true },
    })
    const byId = new Map(involved.map((p) => [p.id, p]))
    if (!byId.has(productId)) {
      return NextResponse.json({ error: "Ürün bulunamadı" }, { status: 404 })
    }
    for (const componentId of componentIds) {
      if (!byId.has(componentId)) {
        return NextResponse.json({ error: "Bileşen ürün bulunamadı" }, { status: 404 })
      }
    }

    // Birim uyumu KAYIT anında doğrulanır — çalışma anında değil. Aksi halde
    // hata ancak satış sırasında ortaya çıkar ve stok sessizce düşmeden kalır.
    for (const item of items) {
      const stockUnit = byId.get(item.componentProductId)!.unit
      if (!canConvert(item.unit, stockUnit)) {
        const name = byId.get(item.componentProductId)!.name
        return NextResponse.json(
          {
            error: `"${name}" için ${item.unit} → ${stockUnit} dönüşümü yapılamıyor. Bileşen birimi, ürünün stok birimiyle aynı ölçü ailesinden olmalı (ör. KG↔GR, LT↔ML).`,
          },
          { status: 400 }
        )
      }
    }

    await assertNoRecipeCycle(prisma, companyId, productId, componentIds)

    const yieldQuantity = Number(body.yieldQuantity)
    const safeYield = Number.isFinite(yieldQuantity) && yieldQuantity > 0 ? yieldQuantity : 1
    const isActive = body.isActive === undefined ? true : Boolean(body.isActive)
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null

    const saved = await prisma.$transaction(async (tx) => {
      const recipe = await tx.productRecipe.upsert({
        where: { productId },
        create: { companyId, productId, yieldQuantity: safeYield, isActive, note },
        update: { yieldQuantity: safeYield, isActive, note },
        select: { id: true },
      })

      await tx.productRecipeItem.deleteMany({ where: { recipeId: recipe.id } })
      await tx.productRecipeItem.createMany({
        data: items.map((item: any) => ({
          recipeId: recipe.id,
          componentProductId: item.componentProductId,
          quantity: item.quantity,
          unit: item.unit,
          wastageRate: Number.isFinite(item.wastageRate) ? item.wastageRate : null,
          order: item.order,
        })),
      })

      return tx.productRecipe.findUniqueOrThrow({
        where: { id: recipe.id },
        select: recipeSelect,
      })
    })

    return NextResponse.json(serialize(saved), { status: 201 })
  } catch (error: any) {
    if (error instanceof RecipeCycleError) {
      return NextResponse.json(
        { error: `Reçete döngüsü oluşur: ${error.chain.join(" → ")}` },
        { status: 400 }
      )
    }
    if (error.message?.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error saving recipe:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
