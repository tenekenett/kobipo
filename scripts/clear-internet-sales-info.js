#!/usr/bin/env node

// Kobipo'nun KENDİ satışlarında (kontör/abonelik) yazılmış internet satış bilgisini
// henüz GİB'e gitmemiş taslaklardan temizler:
//
//   node scripts/clear-internet-sales-info.js          # yalnız rapor (kuru çalışma)
//   node scripts/clear-internet-sales-info.js --apply  # DRAFT'ları temizle
//
// NEDEN: `internetSalesInfo` dolu gönderilen belgeye GİB şablonu "İnternet Satış
// Bilgileri" bloğunu ve mesafeli satış İADE BÖLÜMÜ tablosunu basıyor. Kobipo dijital
// HİZMET satıyor; o tablo alıcıya var olmayan bir ürün iadesi yolu gösteriyor.
// Yeni belgeler artık bu alanı hiç yazmıyor (lib/invoicing/issue-sales-invoice.ts),
// bu betik ARADA KALMIŞ kayıtlar içindir.
//
// KAPSAM — yalnız `status = 'DRAFT'` olanlar temizlenir. Belge Mysoft taslağına
// (GIB_DRAFT) düştüyse model karşı tarafta zaten yazılıdır; alanı burada silmek o
// taslağı değiştirmez. Onlar rapor edilir: Mysoft taslağını iptal edip (discardGibDraft)
// siparişi yeniden faturalandırmak gerekir. SENT/kesilmiş belgelere DOKUNULMAZ —
// kesilmiş fatura değiştirilemez.

require("dotenv").config()
const { Client } = require("pg")

const SELECT_SQL = `
  SELECT id, "invoiceNo", status, "companyId", date
    FROM public.invoices
   WHERE "internetSalesInfo" IS NOT NULL
   ORDER BY date DESC
`

const UPDATE_SQL = `
  UPDATE public.invoices
     SET "internetSalesInfo" = NULL
   WHERE "internetSalesInfo" IS NOT NULL
     AND status = 'DRAFT'
  RETURNING id, "invoiceNo"
`

async function main() {
  const apply = process.argv.includes("--apply")
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error("DATABASE_URL yok (.env).")
    process.exit(1)
  }

  // Bağlantı alanları TEK TEK veriliyor, `connectionString` olarak DEĞİL: `pg`,
  // connectionString'i ayrıştırıp sonuçları açıkça verilen seçeneklerin ÜSTÜNE yazıyor.
  // Supabase URL'i `?sslmode=require` taşıdığı için bu, `rejectUnauthorized: false`'u
  // eziyor ve ara sertifika "self-signed certificate in certificate chain" hatası
  // veriyordu. (Aynı sebeple: scripts/apply-migration.js, scripts/run-migration.js.)
  const parsed = new URL(url)
  const client = new Client({
    host: parsed.hostname,
    port: Number(parsed.port) || 5432,
    database: parsed.pathname.replace(/^\//, "") || "postgres",
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    const { rows } = await client.query(SELECT_SQL)
    if (rows.length === 0) {
      console.log("İnternet satış bilgisi taşıyan fatura yok.")
      return
    }

    const drafts = rows.filter((r) => r.status === "DRAFT")
    const gibDrafts = rows.filter((r) => r.status === "GIB_DRAFT")
    const others = rows.filter((r) => r.status !== "DRAFT" && r.status !== "GIB_DRAFT")

    console.log(`Toplam ${rows.length} fatura internet satış bilgisi taşıyor:`)
    console.log(`  DRAFT (temizlenebilir)        : ${drafts.length}`)
    console.log(`  GIB_DRAFT (Mysoft'ta taslak)  : ${gibDrafts.length}`)
    console.log(`  Kesilmiş/diğer (dokunulmaz)   : ${others.length}`)

    for (const r of gibDrafts) {
      console.log(
        `  ! ${r.invoiceNo} (${r.id}) Mysoft taslağında — alanı silmek o taslağı değiştirmez, ` +
          `taslağı iptal edip yeniden faturalandırın.`,
      )
    }
    for (const r of others) {
      console.log(`  - ${r.invoiceNo} (${r.status}) kesilmiş belge, değiştirilemez.`)
    }

    if (!apply) {
      console.log("\nKuru çalışma. Temizlemek için: node scripts/clear-internet-sales-info.js --apply")
      return
    }
    if (drafts.length === 0) {
      console.log("\nTemizlenecek DRAFT yok.")
      return
    }

    const res = await client.query(UPDATE_SQL)
    console.log(`\n${res.rowCount} taslak temizlendi:`)
    for (const r of res.rows) console.log(`  ✓ ${r.invoiceNo}`)
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
