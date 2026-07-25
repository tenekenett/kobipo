// Reçete verisinin sunucu tarafı yükleyicisi ve kayıt-anı doğrulamaları.
// Saf genişletme mantığı ayrı dosyada: lib/stock/recipe-expand.ts

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { findRecipePath, type RecipeMap } from "@/lib/stock/recipe-expand"

// PrismaClient veya $transaction içindeki client — ikisi de model metodlarını taşır.
type Db = Pick<typeof prisma, "productRecipe" | "product">

export type RecipeContext = {
  recipes: RecipeMap
  /** productId -> stok birimi (bulunamazsa null). */
  unitOf: (productId: string) => string | null
}

/**
 * Bir firmanın TÜM reçetelerini ve ilgili ürünlerin stok birimlerini yükler.
 *
 * Tümünü çekmek bilinçli: genişletme özyinelemeli olduğu için hangi bileşenlere
 * inileceği önceden bilinmiyor, kademeli sorgu ise N+1 üretirdi. Reçete sayısı
 * menü kalemleriyle sınırlı (yüzler mertebesi), tek sorgu ucuz kalıyor.
 */
export async function loadRecipeContext(db: Db, companyId: string): Promise<RecipeContext> {
  const rows = await db.productRecipe.findMany({
    where: { companyId, isActive: true },
    select: {
      productId: true,
      yieldQuantity: true,
      isActive: true,
      items: {
        select: {
          componentProductId: true,
          quantity: true,
          unit: true,
          wastageRate: true,
        },
        orderBy: { order: "asc" },
      },
    },
  })

  const recipes: RecipeMap = new Map()
  const productIds = new Set<string>()

  for (const row of rows) {
    productIds.add(row.productId)
    for (const item of row.items) productIds.add(item.componentProductId)
    recipes.set(row.productId, {
      yieldQuantity: Number(row.yieldQuantity) || 1,
      isActive: row.isActive,
      items: row.items.map((i) => ({
        componentProductId: i.componentProductId,
        quantity: Number(i.quantity) || 0,
        unit: i.unit,
        wastageRate: i.wastageRate != null ? Number(i.wastageRate) : null,
      })),
    })
  }

  const units = new Map<string, string>()
  if (productIds.size > 0) {
    const products = await db.product.findMany({
      where: { id: { in: Array.from(productIds) } },
      select: { id: true, unit: true },
    })
    for (const p of products) units.set(p.id, p.unit)
  }

  return { recipes, unitOf: (id) => units.get(id) ?? null }
}

/**
 * Reçete bileşenlerinin birim maliyetini çözer.
 *
 * Öncelik: `Product.purchasePrice` → yoksa ürünün SON alış (IN) hareketindeki
 * `unitPrice`. Gerekçe: purchasePrice yalnızca elle güncelleniyor (alış faturası
 * kesmek onu değiştirmiyor), ama StockMovement her alışta gerçekten ödenen
 * fiyatı zaten kaydediyor. Aynı kabul mevcut bilanço raporunda da var
 * (app/api/raporlar/bilanco/route.ts).
 *
 * Dönen değer satış anında StockMovement.unitPrice'a YAZILIR (dondurulur):
 * böylece sonradan gelen zam geçmiş günlerin karlılığını değiştirmez.
 */
export async function resolveComponentCosts(
  companyId: string,
  productIds: string[]
): Promise<Map<string, number | null>> {
  const costs = new Map<string, number | null>()
  const ids = Array.from(new Set(productIds.filter(Boolean)))
  if (ids.length === 0) return costs

  const products = await prisma.product.findMany({
    where: { id: { in: ids }, companyId },
    select: { id: true, purchasePrice: true },
  })
  for (const p of products) {
    costs.set(p.id, p.purchasePrice != null ? Number(p.purchasePrice) : null)
  }

  const missing = ids.filter((id) => costs.get(id) == null)
  if (missing.length === 0) return costs

  // Ürün başına SON alış hareketi — tek sorguda (Postgres DISTINCT ON).
  // Alternatifi ürün başına findFirst döngüsü olurdu (N sorgu).
  const rows = await prisma.$queryRaw<Array<{ productId: string; unitPrice: Prisma.Decimal | null }>>`
    SELECT DISTINCT ON ("productId") "productId", "unitPrice"
    FROM public.stock_movements
    WHERE "companyId" = ${companyId}
      AND "productId" IN (${Prisma.join(missing)})
      AND "type" = 'IN'
      AND "unitPrice" IS NOT NULL
    ORDER BY "productId", "createdAt" DESC
  `
  for (const row of rows) {
    if (row.unitPrice != null) costs.set(row.productId, Number(row.unitPrice))
  }

  return costs
}

export class RecipeCycleError extends Error {
  constructor(public chain: string[]) {
    super("Reçete döngüsü")
    this.name = "RecipeCycleError"
  }
}

/**
 * `productId` ürününe `componentIds` bileşenleri eklenirse döngü oluşur mu?
 *
 * Mantık: mevcut grafikte bileşenden ürüne ulaşılabiliyorsa, o bileşeni ürüne
 * eklemek zinciri kapatır. Kendine referans (bileşen = ürün) de bu kontrole
 * doğal olarak takılır.
 *
 * Döngü bulunursa RecipeCycleError fırlatır; zincir ÜRÜN ADLARIYLA doldurulur
 * ki kullanıcı "Latte → Espresso → Latte" şeklinde görebilsin.
 */
export async function assertNoRecipeCycle(
  db: Db,
  companyId: string,
  productId: string,
  componentIds: string[]
): Promise<void> {
  if (componentIds.length === 0) return

  const { recipes } = await loadRecipeContext(db, companyId)

  for (const componentId of componentIds) {
    const path = findRecipePath(componentId, productId, recipes)
    if (!path) continue

    // Zincir: ürün → (eklenen bileşen ... ürün). Adlarla zenginleştir.
    const chainIds = [productId, ...path]
    const products = await db.product.findMany({
      where: { id: { in: Array.from(new Set(chainIds)) } },
      select: { id: true, name: true },
    })
    const nameById = new Map(products.map((p) => [p.id, p.name]))
    throw new RecipeCycleError(chainIds.map((id) => nameById.get(id) ?? id))
  }
}
