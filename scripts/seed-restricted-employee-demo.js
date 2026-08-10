// Kısıtlı çalışan izinlerini denemek için tek bir demo hesabı kurar.
//
// Kurduğu senaryo (Kobipo Demo Merkez):
//   rol           SALES
//   Müşteri       görüntüle + düzenle
//   Satış Rapor.  yalnız görüntüle
//   diğer her şey kapalı
//
// Idempotent: tekrar çalıştırılınca aynı hesabı günceller, kopya yaratmaz.

require("dotenv").config({ quiet: true })
const bcrypt = require("bcryptjs")
const { PrismaClient } = require("@prisma/client")

const EMAIL = "kasiyer@demo.kobipo.test"
const PASSWORD = "Kasiyer2026!"
const COMPANY_SLUG = "kobipo-demo-merkez"

const ALLOWED = ["/cari/musteri", "/raporlar/satis"]
const WRITABLE = ["/cari/musteri"]

const prisma = new PrismaClient()

async function main() {
  const company = await prisma.company.findUnique({
    where: { slug: COMPANY_SLUG },
    select: { id: true, name: true },
  })
  if (!company) throw new Error(`Firma bulunamadı: ${COMPANY_SLUG}`)

  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { password: await bcrypt.hash(PASSWORD, 10) },
    create: {
      email: EMAIL,
      name: "Demo Kasiyer",
      password: await bcrypt.hash(PASSWORD, 10),
      emailVerified: new Date(),
    },
    select: { id: true },
  })

  const membership = await prisma.userCompany.upsert({
    where: { userId_companyId: { userId: user.id, companyId: company.id } },
    update: { role: "SALES", allowedPaths: ALLOWED, writablePaths: WRITABLE },
    create: {
      userId: user.id,
      companyId: company.id,
      role: "SALES",
      allowedPaths: ALLOWED,
      writablePaths: WRITABLE,
    },
    select: { id: true, role: true, allowedPaths: true, writablePaths: true },
  })

  console.log("Firma      :", company.name)
  console.log("E-posta    :", EMAIL)
  console.log("Şifre      :", PASSWORD)
  console.log("Rol        :", membership.role)
  console.log("Görebilir  :", membership.allowedPaths.join(", "))
  console.log("Yazabilir  :", membership.writablePaths.join(", "))
}

main()
  .catch((e) => {
    console.error("HATA:", e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
