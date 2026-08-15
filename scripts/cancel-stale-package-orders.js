// Bildirimi hiç ulaşmadığı için PENDING_PAYMENT'ta çakılı kalmış paket/abonelik
// siparişlerini iptal eder (CANCELLED).
//
// Neden gerekti: PayTR bildirim URL'si mağaza başına tek olduğu ve panelde kontör adresi
// yazılı olduğu için paket ödemelerinin bildirimi yanlış uca düşüp sessizce yutuluyordu
// (bkz. docs/paket-abonelik/ILERLEME.md → "tek bildirim URL'si"). Düzeltme sonrası yeni
// ödemeler doğru işlenir; bu eski kayıtlar ekranlarda "Ödemeniz doğrulanıyor…" olarak
// asılı kalmasın diye kapatılır.
//
// DİKKAT: Bu betik ödemenin alınıp alınmadığını PayTR'a SORMAZ. Tahsilat yapılmış bir
// siparişi iptal etmek müşteriyi ödediği hizmetsiz bırakır. Şüpheliyse önce PayTR
// panelinden teyit edin; teyitliyse iptal yerine sistem-admin → "Aktifleştir" kullanın.
//
// Kullanım:
//   node scripts/cancel-stale-package-orders.js           # yalnız listeler (kuru çalışma)
//   node scripts/cancel-stale-package-orders.js --apply   # iptal eder

require("dotenv").config({ path: ".env.local" })
require("dotenv").config() // fallback .env
const { PrismaClient } = require("@prisma/client")

const prisma = new PrismaClient()
const apply = process.argv.includes("--apply")

async function main() {
  const orders = await prisma.packageOrder.findMany({
    where: { status: "PENDING_PAYMENT" },
    orderBy: { createdAt: "desc" },
    include: { company: { select: { name: true, slug: true } } },
  })

  if (orders.length === 0) {
    console.log("Bekleyen paket siparişi yok.")
    return
  }

  console.log(`${orders.length} bekleyen sipariş:\n`)
  for (const o of orders) {
    console.log(
      `  ${o.createdAt.toISOString().slice(0, 16)}  ${o.id}\n` +
        `    ${o.company?.name} (/${o.company?.slug})\n` +
        `    tutar=${o.amount} TL  şube=${o.branchQuota} firma=${o.companyQuota}  ` +
        `modüller=[${o.resolvedModules.join(",") || "—"}]  paidAt=${o.paidAt ?? "—"}\n`,
    )
  }

  if (!apply) {
    console.log("Kuru çalışma — hiçbir şey değişmedi. İptal için: --apply ekleyin.")
    return
  }

  const res = await prisma.packageOrder.updateMany({
    // paidAt dolu olan ASLA iptal edilmez: ödeme kaydedilmiş, karşılığı verilmeli.
    where: { status: "PENDING_PAYMENT", paidAt: null },
    data: {
      status: "CANCELLED",
      paymentError: "Ödeme bildirimi ulaşmadı — sipariş kapatıldı (tek bildirim URL'si hatası).",
    },
  })
  console.log(`✓ ${res.count} sipariş CANCELLED yapıldı.`)

  const skipped = orders.filter((o) => o.paidAt)
  if (skipped.length > 0) {
    console.log(
      `\n⚠ ${skipped.length} sipariş ATLANDI (paidAt dolu — ödeme kaydedilmiş):\n` +
        skipped.map((o) => `    ${o.id}`).join("\n") +
        `\n  Bunları sistem-admin → "Aktifleştir" ile açın.`,
    )
  }
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect())
