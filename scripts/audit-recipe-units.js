require("dotenv").config({ path: ".env.local" })
require("dotenv").config()
const { PrismaClient } = require("@prisma/client")

const prisma = new PrismaClient()

/**
 * Birimi ÇEVRİLEMEYEN reçete kalemlerini ve seçenek etkilerini listeler.
 *
 * Neden: birim uyumu reçete kaydedilirken doğrulanıyordu, ama hammaddenin stok
 * birimi sonradan Stok ekranından değiştirilebiliyordu (kahve KG → ADET). Böyle
 * bir değişiklikten sonra o reçeteler satışta UNIT_MISMATCH'e düşer;
 * expandRecipeLines bileşeni ATLAR ve hata yalnızca log'a yazılır — yani satış
 * geçer, hammadde hiç düşmez. Sessiz stok kaybı.
 *
 * Değişiklik artık istekte engelleniyor (app/api/stok/products/[id] PUT →
 * findRecipeUnitConflicts), ama ÖNCEDEN bozulmuş kayıtlar öyle kaldı. Bu script
 * onları bulur. Hiçbir şeyi DEĞİŞTİRMEZ, yalnızca raporlar.
 *
 * Kullanım:
 *   node scripts/audit-recipe-units.js            # tüm firmalar
 *   node scripts/audit-recipe-units.js <firmaId>  # tek firma
 */

// lib/data/units.ts'teki aileler — script CommonJS olduğu için TS modülü
// import edilemiyor. Kural değişirse İKİSİ birlikte güncellenmeli.
const UNIT_FAMILIES = {
  GR: "mass",
  KG: "mass",
  TON: "mass",
  ML: "volume",
  LT: "volume",
  CM: "length",
  MT: "length",
}

function canConvert(from, to) {
  const f = String(from || "").trim().toUpperCase()
  const t = String(to || "").trim().toUpperCase()
  if (!f || !t) return false
  if (f === t) return true
  return Boolean(UNIT_FAMILIES[f] && UNIT_FAMILIES[t] && UNIT_FAMILIES[f] === UNIT_FAMILIES[t])
}

async function main() {
  const companyId = process.argv[2] || undefined
  const where = companyId ? { companyId } : {}

  const items = await prisma.productRecipeItem.findMany({
    where: { recipe: where },
    select: {
      unit: true,
      quantity: true,
      recipe: {
        select: {
          isActive: true,
          companyId: true,
          product: { select: { name: true } },
        },
      },
      component: { select: { name: true, unit: true } },
    },
  })

  const broken = items.filter((i) => !canConvert(i.unit, i.component.unit))

  console.log(`Reçete kalemi taranan: ${items.length}`)
  if (broken.length === 0) {
    console.log("✓ Çevrilemeyen reçete kalemi yok.")
  } else {
    console.log(`\n✗ ${broken.length} reçete kalemi çevrilemiyor:\n`)
    for (const i of broken) {
      const state = i.recipe.isActive ? "AKTİF" : "pasif"
      console.log(
        `  [${state}] ${i.recipe.product.name} → ${i.component.name}: ` +
          `reçetede ${i.quantity} ${i.unit}, stok birimi ${i.component.unit}` +
          (companyId ? "" : `  (firma ${i.recipe.companyId})`)
      )
    }
    console.log(
      "\n  Düzeltme: Menü & Reçeteler → ilgili ürünün reçetesini açıp bileşen\n" +
        "  birimini stok birimiyle aynı aileden bir birime çekin (ya da hammaddenin\n" +
        "  stok birimini eski haline döndürün). AKTİF olanlar şu anda satışta\n" +
        "  stoktan düşmüyor."
    )
  }

  // Seçenek (porsiyon/modifier) "ekleme" etkileri aynı riski taşır.
  const options = await prisma.productOption.findMany({
    where: { effectMode: "ADD", ...(companyId ? { group: { companyId } } : {}) },
    select: {
      name: true,
      effectUnit: true,
      effectQuantity: true,
      toProductId: true,
      group: { select: { companyId: true, product: { select: { name: true } } } },
    },
  })

  const targetIds = Array.from(new Set(options.map((o) => o.toProductId).filter(Boolean)))
  const targets = targetIds.length
    ? await prisma.product.findMany({
        where: { id: { in: targetIds } },
        select: { id: true, name: true, unit: true },
      })
    : []
  const targetById = new Map(targets.map((p) => [p.id, p]))

  const brokenOptions = options.filter((o) => {
    const target = o.toProductId ? targetById.get(o.toProductId) : null
    return target && !canConvert(o.effectUnit, target.unit)
  })

  console.log(`\nSeçenek "ekleme" etkisi taranan: ${options.length}`)
  if (brokenOptions.length === 0) {
    console.log("✓ Çevrilemeyen seçenek etkisi yok.")
  } else {
    console.log(`\n✗ ${brokenOptions.length} seçenek etkisi çevrilemiyor:\n`)
    for (const o of brokenOptions) {
      const target = targetById.get(o.toProductId)
      console.log(
        `  ${o.group.product.name} · "${o.name}" → ${target.name}: ` +
          `etkide ${o.effectQuantity} ${o.effectUnit}, stok birimi ${target.unit}` +
          (companyId ? "" : `  (firma ${o.group.companyId})`)
      )
    }
    console.log(
      "\n  Düzeltme: Menü & Reçeteler → ürün satırındaki Seçenekler'i açıp\n" +
        "  ekleme birimini yeniden seçin."
    )
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
