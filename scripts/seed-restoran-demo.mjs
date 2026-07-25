// PLAN.md "Doğrulama senaryoları → Kurulum" tablosunu Demo Firma'ya kurar.
// Idempotent: aynı isimli ürün varsa günceller.
import { PrismaClient } from "@prisma/client"
const p = new PrismaClient()

const COMPANY_ID = "cmod4a8xz0001liqswmpjb6x2" // Demo Firma A.Ş.

// 1) Restoran modülünü aç (opt-in olduğu için varsayılan kapalı).
const company = await p.company.findUniqueOrThrow({
  where: { id: COMPANY_ID },
  select: { name: true, disabledModules: true },
})
const disabled = company.disabledModules.filter((k) => k !== "restaurant" && k !== "stock")
await p.company.update({ where: { id: COMPANY_ID }, data: { disabledModules: disabled } })
console.log(`Modüller açıldı — ${company.name}; kapalı kalanlar:`, disabled)

// 2) Ürünler
// minStock: kahveci satış ekranındaki "Kritik hammadde" paneli bunu kullanıyor
// (stok <= minStockLevel). Vanilya bilinçli olarak eşiğin ALTINDA bırakıldı ki
// panel demo veriyle boş görünmesin.
const defs = [
  { name: "Kahve Çekirdeği", unit: "KG", purchasePrice: 500, stock: 10, minStock: 2, isSellable: false },
  { name: "Süt", unit: "LT", purchasePrice: 30, stock: 20, minStock: 5, isSellable: false },
  { name: "Vanilya Şurubu", unit: "LT", purchasePrice: 200, stock: 2, minStock: 3, isSellable: false },
  { name: "Espresso", unit: "ADET", purchasePrice: null, stock: 0, isSellable: false },
  { name: "Latte", unit: "ADET", purchasePrice: null, salePrice: 85, stock: 0, isSellable: true },
]

const ids = {}
for (const d of defs) {
  const existing = await p.product.findFirst({ where: { companyId: COMPANY_ID, name: d.name } })
  const data = {
    companyId: COMPANY_ID,
    name: d.name,
    unit: d.unit,
    vatRate: 20,
    purchasePrice: d.purchasePrice,
    salePrice: d.salePrice ?? null,
    isSellable: d.isSellable,
    isService: false,
    stockQuantity: d.stock,
    minStockLevel: d.minStock ?? null,
  }
  const product = existing
    ? await p.product.update({ where: { id: existing.id }, data })
    : await p.product.create({ data })
  ids[d.name] = product.id
  console.log(`  ${existing ? "güncellendi" : "oluşturuldu"}: ${d.name} (${product.id})`)
}

// 3) Depo stoğu — satışta adjustWarehouseStock WarehouseStock üzerinden çalışıyor.
let warehouse = await p.warehouse.findFirst({ where: { companyId: COMPANY_ID, isDefault: true } })
if (!warehouse) {
  warehouse = await p.warehouse.create({
    data: { companyId: COMPANY_ID, name: "Merkez Depo", code: "MERKEZ", isDefault: true },
  })
}
for (const d of defs) {
  await p.warehouseStock.upsert({
    where: { warehouseId_productId: { warehouseId: warehouse.id, productId: ids[d.name] } },
    create: { warehouseId: warehouse.id, productId: ids[d.name], quantity: d.stock },
    update: { quantity: d.stock },
  })
}
console.log("Depo:", warehouse.name)

// 4) Reçeteler — Espresso: 20 GR kahve · Latte: 1 Espresso + 200 ML süt + 5 ML vanilya
async function upsertRecipe(productName, items) {
  const productId = ids[productName]
  const recipe = await p.productRecipe.upsert({
    where: { productId },
    create: { companyId: COMPANY_ID, productId, yieldQuantity: 1, isActive: true },
    update: { yieldQuantity: 1, isActive: true },
  })
  await p.productRecipeItem.deleteMany({ where: { recipeId: recipe.id } })
  await p.productRecipeItem.createMany({
    data: items.map((it, order) => ({
      recipeId: recipe.id,
      componentProductId: ids[it.name],
      quantity: it.qty,
      unit: it.unit,
      order,
    })),
  })
  console.log(`  reçete: ${productName} ← ${items.map((i) => `${i.qty} ${i.unit} ${i.name}`).join(" + ")}`)
}

await upsertRecipe("Espresso", [{ name: "Kahve Çekirdeği", qty: 20, unit: "GR" }])
await upsertRecipe("Latte", [
  { name: "Espresso", qty: 1, unit: "ADET" },
  { name: "Süt", qty: 200, unit: "ML" },
  { name: "Vanilya Şurubu", qty: 5, unit: "ML" },
])

console.log("\nKurulum tamam. Firma id:", COMPANY_ID)
await p.$disconnect()
