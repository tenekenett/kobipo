require("dotenv").config()
const { PrismaClient } = require("@prisma/client")
const bcrypt = require("bcryptjs")

const prisma = new PrismaClient()

function parseArgs(argv) {
  const [, , emailArg, passwordArg, ...rest] = argv
  const nameArg = rest.length > 0 ? rest.join(" ") : null

  const email = (emailArg || process.env.ADMIN_EMAIL || "").trim().toLowerCase()
  const password = passwordArg || process.env.ADMIN_PASSWORD || ""
  const name = nameArg || process.env.ADMIN_NAME || "Sistem Yöneticisi"

  return { email, password, name }
}

function usage() {
  console.log("")
  console.log("Kullanım:")
  console.log('  node scripts/create-admin.js <email> <sifre> ["Ad Soyad"]')
  console.log("")
  console.log("Veya ortam degiskenleri ile:")
  console.log("  ADMIN_EMAIL=... ADMIN_PASSWORD=... ADMIN_NAME=... node scripts/create-admin.js")
  console.log("")
  console.log("Ornek:")
  console.log('  node scripts/create-admin.js rifat@erenvinc.com "StrongPass!1" "Rifat Eren"')
}

async function main() {
  const { email, password, name } = parseArgs(process.argv)

  if (!email || !password) {
    console.error("HATA: email ve sifre zorunludur.")
    usage()
    process.exit(1)
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error(`HATA: Gecersiz email formati: ${email}`)
    process.exit(1)
  }
  if (password.length < 6) {
    console.error("HATA: Sifre en az 6 karakter olmalidir.")
    process.exit(1)
  }

  const hashedPassword = await bcrypt.hash(password, 10)

  const existing = await prisma.user.findUnique({ where: { email } })

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name,
      password: hashedPassword,
      isSuperAdmin: true,
    },
    create: {
      email,
      name,
      password: hashedPassword,
      isSuperAdmin: true,
    },
    select: { id: true, email: true, name: true, isSuperAdmin: true, createdAt: true },
  })

  console.log("")
  console.log(existing ? "Mevcut kullanici GUNCELLENDI (super admin + yeni sifre)." : "Yeni super admin olusturuldu.")
  console.log("----------------------------------------")
  console.log(`ID           : ${user.id}`)
  console.log(`Email        : ${user.email}`)
  console.log(`Ad           : ${user.name ?? "-"}`)
  console.log(`isSuperAdmin : ${user.isSuperAdmin}`)
  console.log(`CreatedAt    : ${user.createdAt.toISOString()}`)
  console.log("----------------------------------------")
  console.log("Giris: /signin  (sistem yoneticisi paneli: /system-admin/signin)")
}

main()
  .catch((e) => {
    console.error("HATA:", e?.message || e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
