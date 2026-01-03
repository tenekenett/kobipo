import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const prisma = new PrismaClient()

async function main() {
  const demoEmail = "demo@muhasebe.com"
  const demoPassword = "demo123"
  const demoName = "Demo Kullanıcı"

  // Mevcut demo kullanıcıyı kontrol et
  const existingUser = await prisma.user.findUnique({
    where: { email: demoEmail },
  })

  if (existingUser) {
    console.log("Demo kullanıcı zaten mevcut!")
    console.log(`Email: ${demoEmail}`)
    console.log(`Şifre: ${demoPassword}`)
    return
  }

  // Şifreyi hashle
  const hashedPassword = await bcrypt.hash(demoPassword, 10)

  // Demo kullanıcı oluştur
  const user = await prisma.user.create({
    data: {
      name: demoName,
      email: demoEmail,
      password: hashedPassword,
    },
  })

  // Demo firma oluştur
  const company = await prisma.company.create({
    data: {
      name: "Demo Firma A.Ş.",
      taxNumber: "1234567890",
      taxOffice: "Kadıköy",
      address: "Demo Adres, Demo Mahalle",
      city: "İstanbul",
      phone: "02121234567",
      email: "info@demofirma.com",
    },
  })

  // Kullanıcıyı firmaya bağla
  await prisma.userCompany.create({
    data: {
      userId: user.id,
      companyId: company.id,
      role: "ADMIN",
    },
  })

  console.log("✅ Demo kullanıcı başarıyla oluşturuldu!")
  console.log("\n📋 Demo Giriş Bilgileri:")
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  console.log(`Email:    ${demoEmail}`)
  console.log(`Şifre:    ${demoPassword}`)
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  console.log("\n💡 Bu bilgileri kullanarak sisteme giriş yapabilirsiniz.")
}

main()
  .catch((e) => {
    console.error("Hata:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

