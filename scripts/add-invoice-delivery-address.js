/**
 * invoices tablosuna sevk adresi kolonlarını ekler:
 *   deliveryAddress (açık adres, yalnız Kobipo içi) · deliveryDistrict · deliveryCity · deliveryCountry
 *
 * `prisma db push` YERİNE hedefli ALTER kullanılıyor: veritabanında gerçek müşteri
 * firmaları var ve db push, şemada sürüklenme varsa beklenmedik değişiklik
 * uygulayabilir. Buradaki işlem tamamen EKLEMELİ ve idempotent (bkz.
 * supabase/migrations/20260805000005_invoice_delivery_address.sql).
 *
 * Kullanım:  node scripts/add-invoice-delivery-address.js [--apply]
 * Argümansız çalıştırıldığında hiçbir şey YAZMAZ, yalnızca durumu raporlar.
 */
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const APPLY = process.argv.includes("--apply")
const COLUMNS = ["deliveryAddress", "deliveryDistrict", "deliveryCity", "deliveryCountry"]

async function columnExists(column) {
  const [{ exists }] = await prisma.$queryRaw`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = ${column}
    ) AS exists
  `
  return exists
}

async function report() {
  for (const c of COLUMNS) {
    console.log(`invoices."${c}" mevcut mu: ${await columnExists(c)}`)
  }
}

async function main() {
  await report()
  console.log(`fatura sayisi: ${await prisma.invoice.count()}`)

  if (!APPLY) {
    console.log("\n[KURU ÇALIŞMA] Yazma yapılmadı. Uygulamak için: --apply")
    return
  }

  for (const c of COLUMNS) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS "${c}" text`
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
