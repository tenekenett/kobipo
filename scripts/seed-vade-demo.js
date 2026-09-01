#!/usr/bin/env node

// Ay içi ödeme planını (1-10 / 11-20 / 21-ay sonu) GÖRÜNÜR kılmak için birkaç
// açık faturaya VADE TARİHİ yazar.
//
//   node scripts/seed-vade-demo.js            → vadeleri yazar
//   node scripts/seed-vade-demo.js --revert   → hepsini tekrar NULL yapar
//
// Neden yeni fatura üretmiyoruz: yeni belge cari bakiyesini, satış raporunu ve
// stoğu kirletirdi. Buradaki eksik zaten VADE; para mevcut faturalarda duruyor.
// Seçilen faturaların hepsinde `dueDate` NULL'dı, o yüzden geri alma kayıpsızdır.

require("dotenv").config({ path: ".env.local" })
require("dotenv").config()
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const COMPANY_ID = "cmojuwru30002my8i42blsjch" // Reypo Medya Ajansı

// Vadeler bilinçli olarak Eylül 2026'nın üç dilimine + bir önceki/sonraki aya
// dağıtıldı: plan sayfasındaki her sütunun dolu olduğu görülebilsin.
const PLAN = [
  { invoiceNo: "SAT-2026-0105", due: "2026-09-05", dilim: "1-10 Eylül" },
  { invoiceNo: "SAT-2026-0099", due: "2026-09-08", dilim: "1-10 Eylül" },
  { invoiceNo: "SAT-2026-0100", due: "2026-09-12", dilim: "11-20 Eylül" },
  { invoiceNo: "SAT-2026-0101", due: "2026-09-18", dilim: "11-20 Eylül" },
  { invoiceNo: "SAT-2026-0102", due: "2026-09-22", dilim: "21-30 Eylül" },
  { invoiceNo: "SAT-2026-0103", due: "2026-09-29", dilim: "21-30 Eylül" },
  { invoiceNo: "SAT-2026-0104", due: "2026-08-20", dilim: "Geçmiş Aylar" },
  { invoiceNo: "SAT-2026-0106", due: "2026-10-10", dilim: "Sonraki Aylar" },
  { invoiceNo: "SAT-2026-0049", due: "2026-09-07", dilim: "1-10 Eylül" },
  { invoiceNo: "SAT-2026-0063", due: "2026-09-15", dilim: "11-20 Eylül" },
  { invoiceNo: "SAT-2026-0072", due: "2026-09-25", dilim: "21-30 Eylül" },
]

async function main() {
  const revert = process.argv.includes("--revert")
  const numbers = PLAN.map((p) => p.invoiceNo)

  const invoices = await prisma.invoice.findMany({
    where: { companyId: COMPANY_ID, invoiceNo: { in: numbers } },
    select: { id: true, invoiceNo: true, dueDate: true, totalAmount: true },
  })
  const byNo = new Map(invoices.map((i) => [i.invoiceNo, i]))

  const eksik = numbers.filter((n) => !byNo.has(n))
  if (eksik.length) console.warn(`⚠ bulunamayan fatura: ${eksik.join(", ")}`)

  for (const row of PLAN) {
    const invoice = byNo.get(row.invoiceNo)
    if (!invoice) continue
    const dueDate = revert ? null : new Date(`${row.due}T00:00:00.000Z`)
    await prisma.invoice.update({ where: { id: invoice.id }, data: { dueDate } })
    console.log(
      revert
        ? `↩ ${row.invoiceNo}: vade kaldırıldı`
        : `✓ ${row.invoiceNo} (${Number(invoice.totalAmount).toLocaleString("tr-TR")} TL) → vade ${row.due} · ${row.dilim}`
    )
  }

  console.log(revert ? "\nVadeler geri alındı." : "\nVadeler yazıldı. Geri almak için: node scripts/seed-vade-demo.js --revert")
  await prisma.$disconnect()
}

main().catch(async (error) => {
  console.error(error)
  await prisma.$disconnect()
  process.exit(1)
})
