// PayTR sunucu-sunucu ödeme bildirimini (callback) YERELDE simüle eder.
//
// Neden: localhost'a PayTR erişemediği için gerçek callback gelmez → sipariş PENDING kalır.
// Bu script env'deki merchant key/salt ile geçerli HMAC üretip yerel callback ucuna POST'lar,
// böylece paket siparişi ACTIVE'e geçer (abonelik + modül yetkileri uygulanır).
//
// Kullanım (dev sunucusu açıkken):
//   node scripts/paytr-simulate-callback.js <orderId> [success|failed]
//   npm run paytr:simulate -- <orderId> [success|failed]
//
// Sadece TEST/geliştirme içindir. Prod'da PayTR panelindeki gerçek bildirim URL'si kullanılır.

require("dotenv").config({ path: ".env.local" })
require("dotenv").config() // fallback .env
const crypto = require("node:crypto")
const { PrismaClient } = require("@prisma/client")

const prisma = new PrismaClient()

const orderId = process.argv[2]
const status = process.argv[3] || "success"
const BASE = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"

async function main() {
  if (!orderId) {
    console.log("Kullanım: node scripts/paytr-simulate-callback.js <orderId> [success|failed]")
    return
  }
  const key = process.env.PAYTR_MERCHANT_KEY
  const salt = process.env.PAYTR_MERCHANT_SALT
  if (!key || !salt) {
    console.log("PAYTR_MERCHANT_KEY / PAYTR_MERCHANT_SALT env yok (.env.local kontrol et).")
    return
  }

  const order = await prisma.packageOrder.findUnique({
    where: { id: orderId },
    include: { company: { select: { name: true, slug: true } } },
  })
  if (!order) {
    console.log(`Sipariş bulunamadı: ${orderId}`)
    return
  }

  // Callback siparişi merchantOidBase() ile çözer → base = order.id yeter (ekli suffix olmadan).
  const merchantOid = order.id
  const totalAmount = String(Math.round(Number(order.amount) * 100)) // kuruş
  // hash = base64( HMAC_SHA256( merchant_oid + salt + status + total_amount, key ) )
  const hash = crypto
    .createHmac("sha256", key)
    .update(`${merchantOid}${salt}${status}${totalAmount}`)
    .digest("base64")

  const body = new URLSearchParams({
    merchant_oid: merchantOid,
    status,
    total_amount: totalAmount,
    hash,
    payment_type: "card",
    failed_reason_msg: status === "success" ? "" : "Simüle edilmiş başarısız ödeme",
  })

  console.log(`→ ${order.company?.name}(/${order.company?.slug}) sipariş ${orderId}`)
  console.log(`  status=${status}  amount=${order.amount} (${totalAmount} kuruş)`)
  console.log(`  POST ${BASE}/api/billing/paytr/callback`)

  const res = await fetch(`${BASE}/api/billing/paytr/callback`, { method: "POST", body })
  const text = await res.text()
  const ok = text.trim() === "OK"
  console.log(`  ← HTTP ${res.status}  gövde="${text}"  ${ok ? "✓ işlendi" : "✗ (OK değil)"}`)
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect())
