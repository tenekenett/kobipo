// Reçete verisinin sunucu tarafı yükleyicisi ve kayıt-anı doğrulamaları.
// Saf genişletme mantığı ayrı dosyada: lib/stock/recipe-expand.ts

import { prisma } from "@/lib/db/prisma"
import { canConvert } from "@/lib/data/units"
import { findRecipePath, type RecipeMap } from "@/lib/stock/recipe-expand"

// PrismaClient veya $transaction içindeki client — ikisi de model metodlarını taşır.
type Db = Pick<typeof prisma, "productRecipe" | "product">
type ItemDb = Pick<typeof prisma, "productRecipeItem">

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

// NOT: Bileşen maliyeti artık burada çözülmüyor. Tek tanım lib/stock/cost.ts →
// `resolveUnitCosts` (AVCO). Eskiden bu dosyadaki `resolveComponentCosts`
// "purchasePrice → son alış" önceliğini uygularken reçete ekranı tam TERSİNİ
// (AVCO → purchasePrice) kullanıyordu; ekrandaki marj ile rapordaki marj bu
// yüzden ayrışıyordu. Bkz. docs/restoran/SADELESTIRME.md "İş 2".

/**
 * Ürünün stok birimi `nextUnit` yapılırsa, onu BİLEŞEN olarak kullanan reçetelerde
 * hangi kalemler çevrilemez hale gelir?
 *
 * Neden gerekli: birim uyumu reçete KAYDEDİLİRKEN doğrulanıyor (canConvert), ama
 * hammaddenin kartı sonradan Stok ekranından düzenlenebiliyor. Kahve KG'den ADET'e
 * çevrildiğinde GR cinsinden yazılmış tüm reçeteler geçersizleşiyor ve bu ancak
 * SATIŞ anında ortaya çıkıyor: expandRecipeLines UNIT_MISMATCH döndürüp bileşeni
 * atlıyor, hata yalnızca log'a yazılıyor — yani satış geçiyor, hammadde hiç
 * düşmüyor. Sessiz stok kaybının tek kapatılabileceği yer burası: değişikliği
 * yapan istek.
 *
 * Boş dizi = değişiklik güvenli.
 */
export async function findRecipeUnitConflicts(
  db: ItemDb,
  companyId: string,
  componentProductId: string,
  nextUnit: string
): Promise<Array<{ recipeProductName: string; itemUnit: string }>> {
  const items = await db.productRecipeItem.findMany({
    where: { componentProductId, recipe: { companyId } },
    select: {
      unit: true,
      recipe: { select: { product: { select: { name: true } } } },
    },
  })

  return items
    .filter((item) => !canConvert(item.unit, nextUnit))
    .map((item) => ({
      recipeProductName: item.recipe.product.name,
      itemUnit: item.unit,
    }))
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
