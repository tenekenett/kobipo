/**
 * products.isIngredient kolonunu ekler ve geriye dönük doldurur.
 *
 * `prisma db push` YERİNE hedefli ALTER kullanılıyor: veritabanında gerçek müşteri
 * firmaları var ve db push, şemada sürüklenme varsa beklenmedik değişiklik
 * uygulayabilir. Buradaki işlem tamamen EKLEMELİ ve idempotent.
 *
 * Doldurma kuralı — bugünkü ekran davranışı birebir korunsun diye:
 *   isIngredient = true, eğer ürün
 *     (a) herhangi bir reçetede bileşen olarak geçiyorsa (gerçek hammadde), VEYA
 *     (b) isSellable = false ise (Menü & Reçeteler ekranının bugüne kadarki
 *         "Hammaddeler" sekmesi tam olarak bunu gösteriyordu).
 *
 * Kullanım:  node scripts/add-is-ingredient.js [--apply]
 * Argümansız çalıştırıldığında hiçbir şey YAZMAZ, yalnızca ne olacağını raporlar.
 */
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const APPLY = process.argv.includes("--apply")

async function main() {
  const [{ exists }] = await prisma.$queryRaw`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'isIngredient'
    ) AS exists
  `
  console.log(`kolon mevcut mu: ${exists}`)

  // Doldurulacak satırları önceden say — kolon yoksa da hesaplanabilir.
  const [{ used }] = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT "componentProductId") AS used FROM product_recipe_items
  `
  const notSellable = await prisma.product.count({ where: { isSellable: false } })
  const total = await prisma.product.count()
  console.log(`ürün: ${total} · reçetede bileşen olan: ${used} · isSellable=false: ${notSellable}`)

  if (!APPLY) {
    console.log("\n[KURU ÇALIŞMA] Yazma yapılmadı. Uygulamak için: --apply")
    return
  }

  if (!exists) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "isIngredient" BOOLEAN NOT NULL DEFAULT false`
    )
    console.log("kolon eklendi")
  }

  const filled = await prisma.$executeRawUnsafe(`
    UPDATE public.products p
       SET "isIngredient" = true
     WHERE p."isIngredient" = false
       AND (
         p."isSellable" = false
         OR EXISTS (
           SELECT 1 FROM public.product_recipe_items i
            WHERE i."componentProductId" = p.id
         )
       )
  `)
  console.log(`isIngredient=true yapılan ürün: ${filled}`)

  const summary = await prisma.$queryRaw`
    SELECT "isIngredient", "isSellable", COUNT(*) AS n
    FROM public.products GROUP BY 1, 2 ORDER BY 1, 2
  `
  console.log("dağılım:", summary.map((r) => `hammadde=${r.isIngredient} menüde=${r.isSellable} → ${r.n}`))
}

main()
  .catch((e) => {
    console.error("HATA:", e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
