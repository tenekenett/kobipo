#!/usr/bin/env node

// 2026-08-26 uçtan uca indirim kodu testinde üretilen kayıtları siler:
//
//   node scripts/cleanup-discount-test-data.js          # yalnız rapor
//   node scripts/cleanup-discount-test-data.js --apply  # sil
//
// Kapsam DAR tutuldu — yalnız "TEST-E2E-" ile başlayan indirim kodları, onların
// kullanım kayıtları ve testte açılan ÖDENMEMİŞ (PENDING_PAYMENT) iki sipariş.
// Ödenmiş/yüklenmiş hiçbir siparişe dokunmaz.

require("dotenv").config()
const { Client } = require("pg")

const KONTOR_ORDER_ID = process.env.CLEANUP_KONTOR_ORDER_ID || "cmta5y1g600017cr8cawczxqa"
const PACKAGE_ORDER_ID = process.env.CLEANUP_PACKAGE_ORDER_ID || "cmta68rch00037cr8rn9jawv6"

async function main() {
  const apply = process.argv.includes("--apply")
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error("DATABASE_URL yok (.env).")
    process.exit(1)
  }
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
    const codes = await client.query(
      `SELECT code FROM public.discount_codes WHERE code LIKE 'TEST-E2E-%' ORDER BY code`,
    )
    const kontor = await client.query(
      `SELECT id, "packageName", "totalPrice", status FROM public.kontor_orders WHERE id = $1`,
      [KONTOR_ORDER_ID],
    )
    const pkg = await client.query(
      `SELECT id, amount, status FROM public.package_orders WHERE id = $1`,
      [PACKAGE_ORDER_ID],
    )

    console.log(`Test kodu: ${codes.rowCount} (${codes.rows.map((r) => r.code).join(", ") || "-"})`)
    console.log("Kontör siparişi:", kontor.rows[0] || "yok")
    console.log("Paket siparişi:", pkg.rows[0] || "yok")

    const blocked = [...kontor.rows, ...pkg.rows].filter((r) => r.status !== "PENDING_PAYMENT")
    if (blocked.length > 0) {
      console.error("\nDURDURULDU: ödeme durumu PENDING_PAYMENT olmayan sipariş var, silinmez.")
      return
    }
    if (!apply) {
      console.log("\nKuru çalışma. Silmek için: node scripts/cleanup-discount-test-data.js --apply")
      return
    }

    await client.query("BEGIN")
    // Kullanım kayıtları koda CASCADE bağlı; yine de açıkça siliyoruz (sahte sipariş
    // id'li satır da dahil).
    const red = await client.query(
      `DELETE FROM public.discount_code_redemptions
        WHERE "codeId" IN (SELECT id FROM public.discount_codes WHERE code LIKE 'TEST-E2E-%')`,
    )
    const delCodes = await client.query(`DELETE FROM public.discount_codes WHERE code LIKE 'TEST-E2E-%'`)
    const delKontor = await client.query(
      `DELETE FROM public.kontor_orders WHERE id = $1 AND status = 'PENDING_PAYMENT'`,
      [KONTOR_ORDER_ID],
    )
    const delPkg = await client.query(
      `DELETE FROM public.package_orders WHERE id = $1 AND status = 'PENDING_PAYMENT'`,
      [PACKAGE_ORDER_ID],
    )
    await client.query("COMMIT")
    console.log(
      `\nSilindi → kullanım: ${red.rowCount}, kod: ${delCodes.rowCount}, ` +
        `kontör siparişi: ${delKontor.rowCount}, paket siparişi: ${delPkg.rowCount}`,
    )
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {})
    throw e
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
