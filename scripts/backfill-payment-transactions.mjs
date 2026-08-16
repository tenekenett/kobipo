/**
 * GEÇMİŞ tahsilatlara kasa hareketi (Transaction) yazar.
 *
 * Neden gerekli: fiş/POS/adisyon tahsilatları uzun süre yalnız `InvoicePayment`
 * olarak yazıldı; kasanın bakiyesi güncelleniyordu ama HAREKET yazılmıyordu.
 * Pano (gelir/gider, net bakiye, nakit akışı), Finans > Hareketler ve cari
 * ekstre yalnız `transactions` okuduğu için bu para hiçbir yerde görünmüyor.
 * Yazma yolu düzeltildi (app/api/faturalar/odemeler/route.ts); bu betik ondan
 * ÖNCEKİ kayıtları tamamlar.
 *
 * Çalıştırma:
 *   node scripts/backfill-payment-transactions.mjs            # RAPOR (yazmaz)
 *   node scripts/backfill-payment-transactions.mjs --apply    # yazar
 *   node scripts/backfill-payment-transactions.mjs --apply --company=<id>
 *
 * GÜVENLİK:
 *  - Bakiyeye DOKUNMAZ. Para zaten ödeme anında hesaba işlendi; burada yalnız
 *    eksik olan hareket kaydı üretilir. Bakiyeyi de güncellemek parayı ikiye
 *    katlardı.
 *  - Yalnız `transactionId` boş VE `accountId` dolu ödemeler işlenir. Kanalsız
 *    ödemenin yazılacağı bir kasa yoktur (Transaction.accountId zorunlu);
 *    onlar raporda ayrıca sayılır.
 *  - İptal/dönüştürülmüş faturaların ödemeleri atlanır: onların parası zaten
 *    geri alınmış sayılıyor.
 *  - Tekrar çalıştırılabilir: ikinci çalıştırmada işlenecek kayıt kalmaz.
 */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
import { PrismaClient } from "@prisma/client"

loadEnv({ path: ".env.local", override: true })

const prisma = new PrismaClient()
const APPLY = process.argv.includes("--apply")
const companyArg = process.argv.find((a) => a.startsWith("--company="))
const onlyCompany = companyArg ? companyArg.split("=")[1] : null

const money = (n) => Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2 })

async function main() {
  const payments = await prisma.invoicePayment.findMany({
    where: {
      transactionId: null,
      accountId: { not: null },
      ...(onlyCompany ? { companyId: onlyCompany } : {}),
      invoice: { status: { notIn: ["CANCELLED", "CONVERTED"] } },
    },
    select: {
      id: true,
      companyId: true,
      accountId: true,
      amount: true,
      paymentDate: true,
      reference: true,
      createdBy: true,
      invoice: {
        select: {
          invoiceNo: true,
          type: true,
          currency: true,
          customerId: true,
          supplierId: true,
        },
      },
      company: { select: { name: true } },
    },
    orderBy: { paymentDate: "asc" },
  })

  const skipped = await prisma.invoicePayment.count({
    where: {
      transactionId: null,
      accountId: null,
      ...(onlyCompany ? { companyId: onlyCompany } : {}),
      invoice: { status: { notIn: ["CANCELLED", "CONVERTED"] } },
    },
  })

  const byCompany = new Map()
  for (const p of payments) {
    const key = p.companyId
    const cur = byCompany.get(key) ?? { name: p.company.name, count: 0, sum: 0 }
    cur.count += 1
    cur.sum += Number(p.amount) * (p.invoice.type === "SALES" ? 1 : -1)
    byCompany.set(key, cur)
  }

  console.log(`\n${APPLY ? "YAZILIYOR" : "RAPOR (yazılmıyor)"} — ${payments.length} tahsilat/ödeme\n`)
  for (const [id, row] of byCompany) {
    console.log(`  ${row.name}`)
    console.log(`    ${row.count} kayıt · net ${money(row.sum)} TL · ${id}`)
  }
  if (skipped > 0) {
    console.log(`\n  ! ${skipped} ödeme KANALSIZ (accountId boş) — hareket yazılamaz, atlandı.`)
  }
  if (payments.length === 0) {
    console.log("  · İşlenecek kayıt yok.")
  }

  if (!APPLY) {
    console.log("\nYazmak için: node scripts/backfill-payment-transactions.mjs --apply\n")
    return
  }

  let written = 0
  for (const p of payments) {
    const isSales = p.invoice.type === "SALES"
    await prisma.$transaction(async (db) => {
      const trx = await db.transaction.create({
        data: {
          companyId: p.companyId,
          accountId: p.accountId,
          type: isSales ? "INCOME" : "EXPENSE",
          amount: p.amount,
          currency: p.invoice.currency || "TRY",
          description: `${isSales ? "Tahsilat" : "Ödeme"} — ${p.invoice.invoiceNo}`,
          // Tarih ÖDEMENİN tarihi: nakit akışı grafiği bugüne yığılmamalı.
          date: p.paymentDate,
          customerId: p.invoice.customerId,
          supplierId: p.invoice.supplierId,
          reference: p.reference,
          createdBy: p.createdBy,
        },
      })
      await db.invoicePayment.update({
        where: { id: p.id },
        data: { transactionId: trx.id },
      })
    })
    written += 1
    if (written % 50 === 0) console.log(`  · ${written}/${payments.length}`)
  }

  console.log(`\n${written} kasa hareketi yazıldı. Bakiyelere dokunulmadı.\n`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
