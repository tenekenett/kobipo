/**
 * "Şube ismi" alanının kolonlarını ekler:
 *   companies."branchName"        → firmanın/şubenin ayırt edici kısa adı
 *   users."companyBranchName"     → kayıt formunda sorulan şube ismi (ilk firmaya taşınır)
 *
 * `prisma db push` YERİNE hedefli ALTER kullanılıyor: veritabanında gerçek müşteri
 * firmaları var ve db push, şemada sürüklenme varsa beklenmedik değişiklik
 * uygulayabilir. Buradaki işlem tamamen EKLEMELİ ve idempotent (bkz.
 * supabase/migrations/20260805000001_company_branch_name.sql ve ..._2_user_...).
 *
 * `name` resmi ÜNVAN'dır ve aynı tüzel kişinin tüm şubelerinde aynıdır; `branchName`
 * yalnızca arayüzde ünvanın yanında parantez içinde gösterilen ayırt edici kısa addır.
 * Geriye dönük doldurma YAPILMAZ — NULL olan kayıtlarda eskisi gibi sadece ünvan görünür.
 *
 * Kullanım:  node scripts/add-company-branch-name.js [--apply]
 * Argümansız çalıştırıldığında hiçbir şey YAZMAZ, yalnızca durumu raporlar.
 */
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const APPLY = process.argv.includes("--apply")

async function columnExists(table, column) {
  const [{ exists }] = await prisma.$queryRaw`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    ) AS exists
  `
  return exists
}

async function report() {
  console.log(`companies."branchName" mevcut mu     : ${await columnExists("companies", "branchName")}`)
  console.log(`users."companyBranchName" mevcut mu  : ${await columnExists("users", "companyBranchName")}`)
}

async function main() {
  await report()

  const [{ total, branches }] = await prisma.$queryRaw`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE "parentCompanyId" IS NOT NULL) AS branches
    FROM public.companies
  `
  console.log(`firma: ${total} · bunların şube olanı: ${branches}`)

  if (!APPLY) {
    console.log("\n[KURU ÇALIŞMA] Yazma yapılmadı. Uygulamak için: --apply")
    return
  }

  await prisma.$executeRawUnsafe(
    `ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS "branchName" text`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "companyBranchName" text`
  )
  console.log("\nALTER çalıştı:")
  await report()
}

main()
  .catch((e) => {
    console.error("HATA:", e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
