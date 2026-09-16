/**
 * Fatura dip toplamı (kuruş farkı düzeltmesi) — uçtan uca test.
 *
 * Çalıştırma:
 *   1) npm run dev            (ayrı terminalde, http://localhost:3000)
 *   2) node scripts/test-fatura-kurus.mjs
 *
 * GERÇEK uçlara GERÇEK HTTP ile gider (mock yok); oturum NextAuth `encode`'uyla
 * üretilen JWT çerezidir. Kalemler ÜRÜNSÜZ girilir (stok oynamaz). Oluşturulan
 * fatura/fiş/sipariş sonunda SİLİNİR.
 *
 * Hesap kuralı: lib/invoice/document-totals.ts (birim testi document-totals.test.ts).
 * Buradaki beklenen rakamlar elle/birim testten alınmıştır; ölçülen şey uçların o
 * kuralla KAYDEDİP kaydetmediğidir:
 *   - resmî fatura POST/PUT → satır yuvarlamalı (GİB belgesiyle aynı) toplam
 *   - PUT kalemsiz → kayıtlı kalemlerden yeniden kurulur, genel iskonto iki kez düşmez
 *   - fiş (isReceipt) → eski yuvarlamasız kural (KDV dahil fiyat ekrandaki rakamı verir)
 *   - fişler → fatura → kuruş farkı dip toplam yuvarlamasıyla kapanır
 *   - sipariş → fatura → başlık kalemlerden kurulur (siparişin kayıtlı toplamı kopyalanmaz)
 */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
import { PrismaClient } from "@prisma/client"
import { encode } from "next-auth/jwt"

loadEnv({ path: ".env.local", override: true })

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000"
const prisma = new PrismaClient()
const NOTES = "TEST kuruş farkı"

let pass = 0
let fail = 0
const failures = []

function check(label, ok, detail) {
  if (ok) {
    pass++
    console.log(`  ✓ ${label}${detail !== undefined ? ` → ${detail}` : ""}`)
  } else {
    fail++
    failures.push(label)
    console.log(`  ✗ ${label}${detail !== undefined ? ` → ${detail}` : ""}`)
  }
}

const n = (v) => (v == null ? null : Number(v))
const r2 = (x) => Math.round(x * 100) / 100
const same = (a, b) => a != null && Math.abs(Number(a) - b) < 0.001

/**
 * Resmî belge kuralının KDV'li kalemler için kopyası (lib/invoice/document-totals.ts):
 * genel iskonto satırlara orantılı dağıtılır (artık son satıra), her satırın matrahı
 * ve KDV'si kuruşa yuvarlanır. .mjs TS modülünü içe alamadığı için burada tekrar
 * yazıldı — modül değişirse burası da değişmeli.
 */
function officialTotals(items, globalDiscount = 0) {
  const nets = items.map((i) => {
    const gross = Number(i.quantity) * Number(i.unitPrice)
    return gross - Math.max(0, Math.min(Number(i.discountAmount || 0), gross))
  })
  const subtotal = nets.reduce((s, x) => s + x, 0)
  const applied = subtotal > 0 ? Math.max(0, Math.min(globalDiscount, subtotal)) : 0
  let distributed = 0
  let net = 0
  let vat = 0
  items.forEach((i, idx) => {
    const share =
      applied > 0
        ? idx === items.length - 1
          ? r2(Math.max(0, applied - distributed))
          : r2((nets[idx] / subtotal) * applied)
        : 0
    distributed += share
    const taxable = r2(nets[idx] - share)
    net += taxable
    vat += r2((taxable * Number(i.vatRate)) / 100)
  })
  net = r2(net)
  vat = r2(vat)
  return { net, vat, total: r2(net + vat) }
}

async function main() {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET
  if (!secret) throw new Error("NEXTAUTH_SECRET bulunamadı (.env / .env.local)")

  const company = await prisma.company.findFirst({
    where: { name: { contains: "Demo Firma" } },
    select: { id: true, name: true },
  })
  if (!company) throw new Error("Demo Firma bulunamadı (scripts/seed-multi-branch-demo.mjs)")
  const membership = await prisma.userCompany.findFirst({
    where: { companyId: company.id, role: "ADMIN" },
    select: { userId: true, role: true, user: { select: { email: true, isSuperAdmin: true } } },
  })
  if (!membership) throw new Error("Demo Firma'da ADMIN kullanıcı yok")
  const customer = await prisma.customer.findFirst({
    where: { companyId: company.id },
    select: { id: true, name: true },
  })
  if (!customer) throw new Error("Demo Firma'da müşteri yok")

  console.log(`Firma    : ${company.name} (${company.id})`)
  console.log(`Kullanıcı: ${membership.user.email} (${membership.role})`)
  console.log(`Sunucu   : ${BASE}\n`)

  const token = await encode({
    token: {
      id: membership.userId,
      email: membership.user.email,
      isSuperAdmin: membership.user.isSuperAdmin || false,
      isBlogEditor: false,
      defaultCompanyId: company.id,
      defaultRole: membership.role,
    },
    secret,
  })
  const cookie = `next-auth.session-token=${token}`
  const api = async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      json = { raw: text.slice(0, 200) }
    }
    return { status: res.status, body: json }
  }
  const today = new Date().toISOString().slice(0, 10)

  // Reypo örneği (docs/finans/KURUS-FARKI.md): belgede ödenecek 31.906,39.
  const reypoItems = [
    { description: "TEST Kuruş 1", quantity: 1, unitPrice: 12345.67, vatRate: 20, discountMode: "AMOUNT", discountAmount: 1000 },
    { description: "TEST Kuruş 2", quantity: 3, unitPrice: 4999.99, vatRate: 20, discountMode: "AMOUNT", discountAmount: 1250.5 },
    { description: "TEST Kuruş 3", quantity: 7, unitPrice: 83.333333, vatRate: 10, discountMode: "PERCENT", discountRate: 3 },
    { description: "TEST Kuruş 4", quantity: 2, unitPrice: 1499.5, vatRate: 1, discountMode: "AMOUNT", discountAmount: 99.99 },
    { description: "TEST Kuruş 5", quantity: 1, unitPrice: 500, vatRate: 20 },
  ]
  // KDV dahil fiyatlı kafe fişi: 12,50 × 7 + 45 × 3 = 222,50 · 7,90 × 1 = 7,90 → 230,40
  const cafeA = [
    { description: "TEST Kuruş Çay", quantity: 7, unitPrice: 12.5 / 1.1, vatRate: 10 },
    { description: "TEST Kuruş Tost", quantity: 3, unitPrice: 45 / 1.1, vatRate: 10 },
  ]
  const cafeB = [{ description: "TEST Kuruş Su", quantity: 1, unitPrice: 7.9 / 1.2, vatRate: 20 }]

  const invoiceIds = []
  let orderId
  try {
    // ── 1. Resmî fatura POST ────────────────────────────────────────────────
    console.log("1) POST /api/e-donusum/invoices — Reypo örneği, genel iskonto 2.000")
    const created = await api("POST", "/api/e-donusum/invoices", {
      companyId: company.id,
      type: "SALES",
      invoiceType: "MANUAL",
      customerId: customer.id,
      date: today,
      currency: "TRY",
      notes: NOTES,
      items: reypoItems,
      globalDiscountAmount: 2000,
    })
    check("fatura oluştu", created.status === 201, created.status)
    const inv = created.body
    if (!inv?.id) throw new Error("fatura id alınamadı: " + JSON.stringify(created.body).slice(0, 300))
    invoiceIds.push(inv.id)
    check("matrah 27.059,98", same(inv.netAmount, 27059.98), inv.netAmount)
    check("KDV 4.846,41", same(inv.vatAmount, 4846.41), inv.vatAmount)
    check("ödenecek 31.906,39 (belgeyle aynı; eski kural 31.906,38 yazardı)", same(inv.totalAmount, 31906.39), inv.totalAmount)
    const l3 = inv.items?.find((i) => i.description === "TEST Kuruş 3")
    check("%3 satır iskontosu kuruşa yuvarlı kaydedildi: 17,50", same(l3?.discountAmount, 17.5), n(l3?.discountAmount))
    check("birim fiyat 6 ondalıkla korundu: 83,333333", same(l3?.unitPrice, 83.333333), n(l3?.unitPrice))

    // ── 2. PUT kalemsiz: genel iskonto iki kez düşmemeli ─────────────────────
    console.log("\n2) PUT — kalem yok, yalnız not: toplamlar DEĞİŞMEMELİ")
    const put1 = await api("PUT", `/api/e-donusum/invoices/${inv.id}?companyId=${company.id}`, {
      companyId: company.id,
      notes: NOTES + " (not)",
      globalDiscountAmount: 2000,
    })
    check("güncellendi", put1.status === 200, put1.status)
    const after1 = await prisma.invoice.findUnique({ where: { id: inv.id } })
    check("matrah aynı 27.059,98 (eski yol iskontoyu 2. kez düşüyordu)", same(after1.netAmount, 27059.98), n(after1.netAmount))
    check("ödenecek aynı 31.906,39", same(after1.totalAmount, 31906.39), n(after1.totalAmount))

    console.log("\n2b) PUT — kalem yok, genel iskonto 1.000: kayıtlı kalemlerden yeniden hesap")
    const stored = await prisma.invoiceItem.findMany({ where: { invoiceId: inv.id }, orderBy: { order: "asc" } })
    const exp1000 = officialTotals(stored, 1000)
    const put2 = await api("PUT", `/api/e-donusum/invoices/${inv.id}?companyId=${company.id}`, {
      companyId: company.id,
      globalDiscountAmount: 1000,
    })
    check("güncellendi", put2.status === 200, put2.status)
    const after2 = await prisma.invoice.findUnique({ where: { id: inv.id } })
    check(`matrah ${exp1000.net}`, same(after2.netAmount, exp1000.net), n(after2.netAmount))
    check(`KDV ${exp1000.vat}`, same(after2.vatAmount, exp1000.vat), n(after2.vatAmount))
    check(`ödenecek ${exp1000.total}`, same(after2.totalAmount, exp1000.total), n(after2.totalAmount))

    // ── 3. PUT kalemli ──────────────────────────────────────────────────────
    console.log("\n3) PUT — kalem değişti (5. kalem 2 adet), genel iskonto 2.000")
    const changed = reypoItems.map((i) => (i.description === "TEST Kuruş 5" ? { ...i, quantity: 2 } : i))
    const put3 = await api("PUT", `/api/e-donusum/invoices/${inv.id}?companyId=${company.id}`, {
      companyId: company.id,
      items: changed,
      globalDiscountAmount: 2000,
    })
    check("güncellendi", put3.status === 200, put3.status)
    const stored3 = await prisma.invoiceItem.findMany({ where: { invoiceId: inv.id }, orderBy: { order: "asc" } })
    const exp3 = officialTotals(stored3, 2000)
    const after3 = await prisma.invoice.findUnique({ where: { id: inv.id } })
    check("kalem sayısı 5", stored3.length === 5, stored3.length)
    check(`ödenecek kayıtlı kalemlerden: ${exp3.total}`, same(after3.totalAmount, exp3.total), n(after3.totalAmount))
    check(`KDV ${exp3.vat}`, same(after3.vatAmount, exp3.vat), n(after3.vatAmount))

    // ── 4. Fiş: eski kural ──────────────────────────────────────────────────
    console.log("\n4) Fiş (isReceipt) — KDV dahil fiyatlı kafe fişi ekrandaki tutarı vermeli")
    const mkReceipt = async (items) =>
      api("POST", "/api/e-donusum/invoices", {
        companyId: company.id,
        type: "SALES",
        invoiceType: "MANUAL",
        isReceipt: true,
        customerId: customer.id,
        date: today,
        currency: "TRY",
        notes: NOTES,
        items,
      })
    const rA = await mkReceipt(cafeA)
    const rB = await mkReceipt(cafeB)
    check("iki fiş oluştu", rA.status === 201 && rB.status === 201, `${rA.status} / ${rB.status}`)
    if (!rA.body?.id || !rB.body?.id) throw new Error("fiş id alınamadı: " + JSON.stringify(rA.body).slice(0, 300))
    invoiceIds.push(rA.body.id, rB.body.id)
    check("fiş A 222,50 (87,50 + 135,00)", same(rA.body.totalAmount, 222.5), rA.body.totalAmount)
    check("fiş B 7,90", same(rB.body.totalAmount, 7.9), rB.body.totalAmount)
    const cay = rA.body.items?.find((i) => i.description === "TEST Kuruş Çay")
    check("fişte birim fiyat yuvarlanmadı (11,363636…)", cay && Math.abs(Number(cay.unitPrice) - 12.5 / 1.1) < 1e-6, n(cay?.unitPrice))

    // ── 5. Fişleri faturaya birleştir ───────────────────────────────────────
    console.log("\n5) Fişler → fatura: tahsil edilen 230,40 korunur, fark yuvarlama satırına")
    const merged = await api("POST", "/api/fisler/faturaya-donustur", {
      companyId: company.id,
      receiptIds: [rA.body.id, rB.body.id],
    })
    check("birleştirildi", merged.status === 200 || merged.status === 201, JSON.stringify(merged.body).slice(0, 120))
    const mergedId = merged.body?.invoice?.id || merged.body?.id
    if (!mergedId) throw new Error("birleşik fatura id alınamadı: " + JSON.stringify(merged.body).slice(0, 300))
    invoiceIds.push(mergedId)
    const mInv = await prisma.invoice.findUnique({ where: { id: mergedId }, include: { items: true } })
    const docExp = officialTotals(mInv.items, 0)
    check("ödenecek = tahsil edilen 230,40", same(mInv.totalAmount, 230.4), n(mInv.totalAmount))
    check(`matrah belge kuralıyla ${docExp.net}`, same(mInv.netAmount, docExp.net), n(mInv.netAmount))
    check(`KDV belge kuralıyla ${docExp.vat}`, same(mInv.vatAmount, docExp.vat), n(mInv.vatAmount))
    const expRounding = r2(230.4 - docExp.total)
    check(
      `yuvarlama satırı ${expRounding} (matrah + KDV + yuvarlama = ödenecek)`,
      same(mInv.payableRoundingAmount ?? 0, expRounding) &&
        same(r2(n(mInv.netAmount) + n(mInv.vatAmount) + n(mInv.payableRoundingAmount ?? 0)), 230.4),
      n(mInv.payableRoundingAmount),
    )

    // ── 6. Sipariş → fatura ─────────────────────────────────────────────────
    console.log("\n6) Sipariş → fatura: başlık kalemlerden, siparişin toplamı kopyalanmaz")
    const order = await api("POST", "/api/siparis", {
      companyId: company.id,
      type: "SALES",
      customerId: customer.id,
      date: today,
      notes: NOTES,
      items: [
        { description: "TEST Kuruş Sipariş 1", quantity: 7, unitPrice: 83.333333, vatRate: 10, discountRate: 0 },
        { description: "TEST Kuruş Sipariş 2", quantity: 7, unitPrice: 83.333333, vatRate: 10, discountRate: 0 },
      ],
    })
    check("sipariş oluştu", order.status === 201 || order.status === 200, order.status)
    orderId = order.body?.id
    if (!orderId) throw new Error("sipariş id alınamadı: " + JSON.stringify(order.body).slice(0, 300))
    // Sipariş kendi (yuvarlamasız) kuralıyla 1.283,33 yazar; belge kuralı 1.283,32.
    check("siparişin kayıtlı toplamı 1.283,33 (yuvarlamasız)", same(order.body.totalAmount, 1283.33), order.body.totalAmount)
    const conv = await api("POST", `/api/siparis/${orderId}/faturaya-donustur`, { companyId: company.id })
    check("faturaya dönüştü", conv.status === 201 || conv.status === 200, conv.status)
    const convId = conv.body?.id || conv.body?.invoice?.id
    if (!convId) throw new Error("dönüşen fatura id alınamadı: " + JSON.stringify(conv.body).slice(0, 300))
    invoiceIds.push(convId)
    const cInv = await prisma.invoice.findUnique({ where: { id: convId } })
    check("fatura ödenecek 1.283,32 (belge kuralı)", same(cInv.totalAmount, 1283.32), n(cInv.totalAmount))
    check("fatura matrah 1.166,66", same(cInv.netAmount, 1166.66), n(cInv.netAmount))
    check("fatura KDV 116,66", same(cInv.vatAmount, 116.66), n(cInv.vatAmount))
  } finally {
    console.log("\n7) Temizlik")
    for (const id of invoiceIds.reverse()) {
      const del = await fetch(`${BASE}/api/e-donusum/invoices/${id}?companyId=${company.id}`, {
        method: "DELETE",
        headers: { cookie },
      })
      check(`fatura/fiş silindi (${id.slice(-6)})`, del.ok, `HTTP ${del.status}`)
    }
    if (orderId) {
      // Dönüştürülmüş sipariş uçtan silinemez (bilinçli kural) — test kaydı doğrudan silinir.
      await prisma.order.delete({ where: { id: orderId } }).catch(() => null)
    }
    const leftover = await prisma.invoice.count({ where: { companyId: company.id, notes: { startsWith: NOTES } } })
    const leftoverItems = await prisma.invoiceItem.count({ where: { description: { startsWith: "TEST Kuruş" } } })
    const leftoverOrders = await prisma.order.count({ where: { companyId: company.id, notes: NOTES } })
    console.log(`  · kalan test faturası: ${leftover} · kalan kalem: ${leftoverItems} · kalan sipariş: ${leftoverOrders}`)
  }

  console.log(`\n${fail === 0 ? "TÜMÜ GEÇTİ" : "BAŞARISIZ"} — ${pass} geçti, ${fail} kaldı`)
  if (failures.length) console.log("Kalanlar:\n  - " + failures.join("\n  - "))
  process.exitCode = fail === 0 ? 0 : 1
}

main()
  .catch((e) => {
    console.error("\nHATA:", e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
