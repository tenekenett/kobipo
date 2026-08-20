#!/usr/bin/env node

// Erişim kayıtlarını saklama süresine göre budar.
//
//   node scripts/prune-access-logs.js            # kuru deneme (hiçbir şey silmez)
//   node scripts/prune-access-logs.js --apply    # uygular
//   node scripts/prune-access-logs.js --days 730 --apply
//
// SÜRE SİZİN KARARINIZ, bu betiğin değil. Varsayılan 730 gün (2 yıl) yalnızca güvenli
// bir başlangıç: saklama süresi hukuki bir tercih (5651 ve KVKK'daki "gerekli süre
// kadar saklama" ilkesi) ve avukatınızla belirlenmeli. Betik ZAMANLANMADI — cron'a
// bağlamadan önce süreyi bilerek seçin.
//
// Not: kaydı silmek geri alınamaz. Kuru deneme çıktısı, silinecek kayıtların sayısını
// ve en yenisinin tarihini gösterir; önce ona bakın.

require("dotenv").config()
const { PrismaClient } = require("@prisma/client")

const prisma = new PrismaClient()

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  if (i === -1) return fallback
  return process.argv[i + 1]
}

async function main() {
  const days = Number(arg("--days", 730))
  if (!Number.isFinite(days) || days < 1) {
    console.error("Geçersiz --days değeri")
    process.exit(1)
  }
  const apply = process.argv.includes("--apply")
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const [total, doomed, newest] = await Promise.all([
    prisma.accessLog.count(),
    prisma.accessLog.count({ where: { createdAt: { lt: cutoff } } }),
    prisma.accessLog.findFirst({
      where: { createdAt: { lt: cutoff } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ])

  console.log(`saklama süresi : ${days} gün (kesim: ${cutoff.toISOString().slice(0, 10)})`)
  console.log(`toplam kayıt   : ${total}`)
  console.log(`silinecek      : ${doomed}${newest ? ` (en yenisi ${newest.createdAt.toISOString().slice(0, 10)})` : ""}`)

  if (!apply) {
    console.log("\nkuru deneme — hiçbir şey silinmedi. Uygulamak için --apply ekleyin.")
    return
  }
  if (doomed === 0) {
    console.log("\nsilinecek kayıt yok.")
    return
  }

  const result = await prisma.accessLog.deleteMany({ where: { createdAt: { lt: cutoff } } })
  console.log(`\n${result.count} kayıt silindi.`)
}

main()
  .catch((e) => {
    console.error("HATA:", e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
