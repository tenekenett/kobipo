#!/usr/bin/env node

// Canlı veritabanının RLS/yetki duruşunu denetler — SALT OKUNUR, hiçbir şey değiştirmez.
//
//   npm run check:rls
//
// Neden var: Prisma migrasyonları yeni tabloyu RLS'siz oluşturur. Bu betik
// `20260811000003_rls_lockdown.sql` ile kurulan duruştan sapmayı yakalar:
//   • public şemada RLS'siz tablo kaldı mı?
//   • anon/authenticated rolleri şemaya ya da tablolara erişim kazandı mı?
//   • storage.objects üzerinde beklenmedik policy açıldı mı?
// Çıkış kodu: sapma varsa 1 (CI'da da kullanılabilir), temizse 0.

require("dotenv").config()
const { Client } = require("pg")

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!url) {
    console.error("❌ DIRECT_URL / DATABASE_URL bulunamadı (.env)")
    process.exit(1)
  }

  // Alanlar tek tek veriliyor: connectionString'deki ?sslmode=require,
  // rejectUnauthorized:false'u eziyor (bkz. scripts/apply-migration.js).
  const parsed = new URL(url)
  const client = new Client({
    host: parsed.hostname,
    port: Number(parsed.port) || 5432,
    database: parsed.pathname.replace(/^\//, "") || "postgres",
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    ssl: { rejectUnauthorized: false },
  })

  const sorunlar = []

  try {
    await client.connect()

    // 1) RLS'siz public tablolar
    const { rows: rlsYok } = await client.query(`
      SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE ns.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity
       ORDER BY c.relname
    `)
    if (rlsYok.length) {
      sorunlar.push(
        `RLS kapalı ${rlsYok.length} tablo: ${rlsYok.map((r) => r.relname).join(", ")}\n` +
          `   → migrasyona ekle: ALTER TABLE <tablo> ENABLE ROW LEVEL SECURITY;`,
      )
    }

    // 2) Data API rolleri public şemaya erişim kazandı mı?
    const { rows: yetki } = await client.query(`
      SELECT has_schema_privilege('anon','public','USAGE') AS anon_usage,
             has_schema_privilege('authenticated','public','USAGE') AS auth_usage,
             (SELECT count(*)::int FROM pg_class c
                JOIN pg_namespace ns ON ns.oid = c.relnamespace
               WHERE ns.nspname='public' AND c.relkind IN ('r','p')
                 AND has_table_privilege('anon', c.oid, 'SELECT')) AS anon_tablo,
             (SELECT count(*)::int FROM pg_class c
                JOIN pg_namespace ns ON ns.oid = c.relnamespace
               WHERE ns.nspname='public' AND c.relkind IN ('r','p')
                 AND has_table_privilege('authenticated', c.oid, 'SELECT')) AS auth_tablo
    `)
    const y = yetki[0]
    if (y.anon_usage) sorunlar.push("anon rolü public şemada USAGE yetkisi kazanmış")
    if (y.auth_usage) sorunlar.push("authenticated rolü public şemada USAGE yetkisi kazanmış")
    if (y.anon_tablo) sorunlar.push(`anon rolü ${y.anon_tablo} tabloda SELECT yetkisi kazanmış`)
    if (y.auth_tablo)
      sorunlar.push(`authenticated rolü ${y.auth_tablo} tabloda SELECT yetkisi kazanmış`)

    // 3) public şemada policy: RLS'i bilerek policy'siz (default deny) tutuyoruz.
    //    Policy eklenmişse bilinçli bir karar olmalı — uyarı olarak raporla.
    const { rows: pol } = await client.query(`
      SELECT c.relname, p.polname
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
        JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE ns.nspname = 'public'
    `)
    if (pol.length) {
      sorunlar.push(
        `public şemada ${pol.length} policy var (duruş: policy'siz default-deny): ` +
          pol.map((p) => `${p.relname}.${p.polname}`).join(", "),
      )
    }

    // 4) storage: objects/buckets RLS açık ve policy'siz kalmalı
    const { rows: st } = await client.query(`
      SELECT c.relname, c.relrowsecurity AS rls,
             (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
        FROM pg_class c
        JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE ns.nspname = 'storage' AND c.relname IN ('objects','buckets')
    `)
    for (const s of st) {
      if (!s.rls) sorunlar.push(`storage.${s.relname} üzerinde RLS KAPALI`)
      if (s.policies > 0)
        sorunlar.push(`storage.${s.relname} üzerinde ${s.policies} policy var (beklenen: 0)`)
    }

    // 5) Public bucket'lar — içerikleri imzasız URL ile herkese açıktır
    const { rows: buckets } = await client.query(
      "SELECT id, public FROM storage.buckets ORDER BY id",
    )
    const acik = buckets.filter((b) => b.public).map((b) => b.id)
    const beklenenAcik = [
      "blog-media", // blog görselleri bilerek public
      // Ürün fotoğrafları: menü ızgarasındaki her kart için imzalı URL üretmek
      // satış ekranını sunucuya bağımlı kılardı. İçerik gizli değil (menü
      // fotoğrafı) ama yol firma id'siyle başlar — bkz. lib/storage/object-store.ts
      "product-images",
    ]
    const beklenmeyen = acik.filter((b) => !beklenenAcik.includes(b))
    if (beklenmeyen.length)
      sorunlar.push(`Beklenmeyen public bucket: ${beklenmeyen.join(", ")} (içeriği herkese açık)`)

    // Özet
    const { rows: özet } = await client.query(`
      SELECT count(*)::int AS toplam
        FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE ns.nspname='public' AND c.relkind IN ('r','p')
    `)
    console.log(`public tablo: ${özet[0].toplam} | RLS'siz: ${rlsYok.length}`)
    console.log(`bucket: ${buckets.map((b) => `${b.id}${b.public ? " (public)" : ""}`).join(", ")}`)

    if (sorunlar.length === 0) {
      console.log("\n✅ RLS duruşu temiz — sapma yok.")
    } else {
      console.log(`\n❌ ${sorunlar.length} sapma:`)
      for (const s of sorunlar) console.log(` • ${s}`)
      process.exitCode = 1
    }
  } catch (error) {
    console.error("❌ Denetim yapılamadı:", error.message)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

main()
