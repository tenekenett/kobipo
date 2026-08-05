/**
 * customers."nickname" ve suppliers."nickname" kolonlarını ekler (cari takma adı).
 *
 * `prisma db push` YERİNE hedefli ALTER kullanılıyor: veritabanında gerçek müşteri
 * firmaları var ve db push, şemada sürüklenme varsa beklenmedik değişiklik
 * uygulayabilir. Buradaki işlem tamamen EKLEMELİ ve idempotent (bkz.
 * supabase/migrations/20260805000004_cari_nickname.sql).
 *
 * Geriye dönük doldurma YAPILMAZ — NULL olan carilerde eskisi gibi sadece ünvan görünür.
 *
 * Kullanım:  node scripts/add-cari-nickname.js [--apply]
 * Argümansız çalıştırıldığında hiçbir şey YAZMAZ, yalnızca durumu raporlar.
 */
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const APPLY = process.argv.includes("--apply")
const TABLES = ["customers", "suppliers"]

async function columnExists(table) {
  const [{ exists }] = await prisma.$queryRaw`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = 'nickname'
    ) AS exists
  `
  return exists
}

async function report() {
  for (const table of TABLES) {
    console.log(`${table}."nickname" mevcut mu: ${await columnExists(table)}`)
  }
}

async function main() {
  await report()
  console.log(`müşteri: ${await prisma.customer.count()} · tedarikçi: ${await prisma.supplier.count()}`)

  if (!APPLY) {
    console.log("\n[KURU ÇALIŞMA] Yazma yapılmadı. Uygulamak için: --apply")
    return
  }

  for (const table of TABLES) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE public.${table} ADD COLUMN IF NOT EXISTS "nickname" text`
    )
  }
  console.log("\nALTER çalıştı:")
  await report()
}

main()
  .catch((e) => {
    console.error("HATA:", e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
