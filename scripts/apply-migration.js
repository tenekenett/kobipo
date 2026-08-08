#!/usr/bin/env node

// Tek bir migrasyon dosyasını canlı veritabanına uygular:
//
//   node scripts/apply-migration.js supabase/migrations/20260808000001_checklist.sql
//
// `run-migration.js`ten farkı dosyayı ARGÜMANDAN alması (o dosya
// initial_schema'ya sabitlenmiş) ve tek transaction'da çalıştırması: Postgres'te
// DDL transactional olduğu için dosyanın ortasında patlayan bir ifade yarım
// uygulanmış şema bırakmaz, hepsi geri alınır.
//
// Neden `supabase db push` değil: repodaki CLI (v1) config'in
// `db.major_version: 17` değerini tanımıyor, `supabase@latest` ise linkli proje
// (interaktif giriş) istiyor.

require("dotenv").config()
const fs = require("fs")
const path = require("path")
const { Client } = require("pg")

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error("Kullanım: node scripts/apply-migration.js <sql-dosyası>")
    process.exit(1)
  }

  const fullPath = path.resolve(file)
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ Dosya bulunamadı: ${fullPath}`)
    process.exit(1)
  }
  const sql = fs.readFileSync(fullPath, "utf-8")

  // DIRECT_URL öncelikli: havuzlanmış (pooler) bağlantı transaction modunda
  // DDL'de sorun çıkarabiliyor.
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!url) {
    console.error("❌ DIRECT_URL / DATABASE_URL bulunamadı (.env)")
    process.exit(1)
  }

  // Bağlantı alanları TEK TEK veriliyor, `connectionString` olarak DEĞİL:
  // `pg`, connectionString'i ayrıştırıp sonuçları açıkça verilen seçeneklerin
  // ÜSTÜNE yazıyor. Supabase URL'i `?sslmode=require` taşıdığı için bu, aşağıdaki
  // `rejectUnauthorized: false`'u eziyor ve Supabase'in ara sertifikası
  // "self-signed certificate in certificate chain" hatası veriyordu.
  // (`scripts/run-migration.js` de aynı sebeple alanları tek tek veriyor.)
  const parsed = new URL(url)
  const client = new Client({
    host: parsed.hostname,
    port: Number(parsed.port) || 5432,
    database: parsed.pathname.replace(/^\//, "") || "postgres",
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    ssl: { rejectUnauthorized: false },
  })

  try {
    await client.connect()
    console.log(`🔄 ${path.basename(fullPath)} uygulanıyor…`)

    await client.query("BEGIN")
    await client.query(sql)
    await client.query("COMMIT")

    console.log("✅ Migrasyon uygulandı.")
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {})
    console.error("❌ Hata (hiçbir değişiklik uygulanmadı):", error.message)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

main()
