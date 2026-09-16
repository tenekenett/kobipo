/**
 * Teklif iskontosunun (satır % / tutar + genel % / tutar) uçtan uca testi.
 *
 * Çalıştırma:
 *   1) npm run dev            (ayrı terminalde, http://localhost:3000)
 *   2) node scripts/test-teklif-iskonto.mjs
 *
 * GERÇEK uçlara GERÇEK HTTP ile gider (mock yok); oturum NextAuth `encode`'uyla
 * üretilen JWT çerezidir. Kalemler ÜRÜNSÜZ girilir (faturaya dönüşüm stok
 * oynatmaz). Oluşturulan teklif + fatura sonunda SİLİNİR.
 *
 * Hesap kuralı: lib/teklif/quote-totals.ts (birim testi quote-totals.test.ts).
 * Buradaki beklenen rakamlar elle hesaplanmıştır; uç o kuralla kaydediyor mu,
 * kayıt faturaya doğru taşınıyor mu — onu ölçer.
 */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
import { PrismaClient } from "@prisma/client"
import { encode } from "next-auth/jwt"

loadEnv({ path: ".env.local", override: true })

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000"
const prisma = new PrismaClient()
const NOTES = "TEST teklif iskontosu"

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
const near = (a, b) => a != null && Math.abs(Number(a) - b) < 0.011

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

  // A: 2 × 1000, KDV %20, satır iskontosu %10  → brüt 2000, isk 200, net 1800, KDV 360
  // B: 3 × 250,  KDV %10, satır iskontosu 50 ₺ → brüt 750,  isk 50,  net 700,  KDV 70
  const lineA = (quantity = 2) => ({
    description: "TEST İskonto A",
    quantity,
    unitPrice: 1000,
    vatRate: 20,
    discountMode: "PERCENT",
    discountRate: 10,
    discountAmount: 0,
  })
  const lineB = {
    description: "TEST İskonto B",
    quantity: 3,
    unitPrice: 250,
    vatRate: 10,
    discountMode: "AMOUNT",
    discountRate: 0,
    discountAmount: 50,
  }

  let quoteId
  let invoiceId
  try {
    // ── 1. Oluştur: genel %10 ───────────────────────────────────────────────
    console.log("1) POST — satır %/tutar + genel %10")
    const created = await api("POST", "/api/teklif", {
      companyId: company.id,
      customerId: customer.id,
      currency: "TRY",
      notes: NOTES,
      items: [lineA(), lineB],
      globalDiscount: { mode: "PERCENT", value: 10 },
    })
    check("teklif oluştu", created.status === 201, created.status)
    quoteId = created.body?.id
    if (!quoteId) throw new Error("teklif id alınamadı: " + JSON.stringify(created.body).slice(0, 300))
    // ara toplam 2500 → genel 250 → net 2250; KDV 430 × 0,9 = 387; toplam 2637
    const q1 = created.body
    check("net (matrah) 2250", near(q1.netAmount, 2250), q1.netAmount)
    check("KDV oransal düştü: 387", near(q1.vatAmount, 387), q1.vatAmount)
    check("toplam 2637", near(q1.totalAmount, 2637), q1.totalAmount)
    check("genel iskonto oranı 10 saklandı", near(q1.globalDiscountRate, 10), q1.globalDiscountRate)
    check("genel iskonto tutarı 250 saklandı", near(q1.globalDiscountAmount, 250), q1.globalDiscountAmount)

    const got = await api("GET", `/api/teklif/${quoteId}?companyId=${company.id}`)
    const a = got.body.items?.find((i) => i.description === "TEST İskonto A")
    const b = got.body.items?.find((i) => i.description === "TEST İskonto B")
    check("yüzde satır: oran 10, tutar 200", near(a?.discountRate, 10) && near(a?.discountAmount, 200), `${a?.discountRate} / ${a?.discountAmount}`)
    check("tutar satırı: oran NULL, tutar 50 (mod kayıttan okunur)", b?.discountRate === null && near(b?.discountAmount, 50), `${b?.discountRate} / ${b?.discountAmount}`)
    check("tutar satırı toplamı 770", near(b?.totalAmount, 770), b?.totalAmount)

    // ── 2. Yalnız durum değiştir: tutarlar ve iskonto kalmalı ──────────────
    console.log("\n2) PUT — yalnız durum")
    const st = await api("PUT", `/api/teklif/${quoteId}?companyId=${company.id}`, { status: "SENT" })
    check("durum güncellendi", st.status === 200 && st.body.status === "SENT", st.body.status)
    check("toplam değişmedi", near(st.body.totalAmount, 2637), st.body.totalAmount)
    check("genel iskonto korundu", near(st.body.globalDiscountRate, 10), st.body.globalDiscountRate)

    // ── 3. Kalem değişir, genel iskonto alanı gönderilmez → %10 korunur ─────
    console.log("\n3) PUT — kalem değişti, genel iskonto alanı yok")
    // A miktarı 4: net 3600, KDV 720 → ara 4300, genel %10 = 430, net 3870, KDV 790 × 0,9 = 711
    const up = await api("PUT", `/api/teklif/${quoteId}?companyId=${company.id}`, {
      items: [lineA(4), lineB],
    })
    check("güncellendi", up.status === 200, up.status)
    check("%10 yeni ara toplama uygulandı: 430", near(up.body.globalDiscountAmount, 430), up.body.globalDiscountAmount)
    check("net 3870", near(up.body.netAmount, 3870), up.body.netAmount)
    check("KDV 711", near(up.body.vatAmount, 711), up.body.vatAmount)
    check("kalem sayısı 2 (eski kalemler silindi)", up.body.items?.length === 2, up.body.items?.length)

    // ── 4. Yalnız genel iskonto: tutar 500 ─────────────────────────────────
    console.log("\n4) PUT — yalnız genel iskonto (500 ₺)")
    // net 3800, KDV 790 × 3800/4300 = 698,14; toplam 4498,14
    const amt = await api("PUT", `/api/teklif/${quoteId}?companyId=${company.id}`, {
      globalDiscount: { mode: "AMOUNT", value: 500 },
    })
    check("oran NULL, tutar 500", amt.body.globalDiscountRate === null && near(amt.body.globalDiscountAmount, 500), `${amt.body.globalDiscountRate} / ${amt.body.globalDiscountAmount}`)
    check("net 3800", near(amt.body.netAmount, 3800), amt.body.netAmount)
    check("KDV 698,14", near(amt.body.vatAmount, 698.14), amt.body.vatAmount)
    check("toplam 4498,14", near(amt.body.totalAmount, 4498.14), amt.body.totalAmount)
    check("kalemlere dokunulmadı", amt.body.items?.length === 2, amt.body.items?.length)

    console.log("\n4b) PUT — genel iskonto kaldır, ara toplamı aşan tutar kırpılır")
    const cleared = await api("PUT", `/api/teklif/${quoteId}?companyId=${company.id}`, { globalDiscount: null })
    check("kaldırıldı (iki kolon NULL)", cleared.body.globalDiscountRate === null && cleared.body.globalDiscountAmount === null)
    check("net 4300", near(cleared.body.netAmount, 4300), cleared.body.netAmount)
    const huge = await api("PUT", `/api/teklif/${quoteId}?companyId=${company.id}`, {
      globalDiscount: { mode: "AMOUNT", value: 99999 },
    })
    check("ara toplamı aşan iskonto 4300'e kırpıldı", near(huge.body.globalDiscountAmount, 4300) && near(huge.body.totalAmount, 0), `${huge.body.globalDiscountAmount} / ${huge.body.totalAmount}`)
    await api("PUT", `/api/teklif/${quoteId}?companyId=${company.id}`, {
      globalDiscount: { mode: "AMOUNT", value: 500 },
    })

    // ── 5. PDF ─────────────────────────────────────────────────────────────
    console.log("\n5) Teklif PDF'i")
    const pdfRes = await fetch(`${BASE}/api/teklif/${quoteId}/pdf?companyId=${company.id}`, { headers: { cookie } })
    const buf = Buffer.from(await pdfRes.arrayBuffer())
    check("PDF üretildi", pdfRes.status === 200 && buf.subarray(0, 4).toString() === "%PDF", `${buf.length} bayt`)

    // ── 6. Faturaya dönüştür ───────────────────────────────────────────────
    console.log("\n6) Faturaya dönüştürme")
    const conv = await api("POST", `/api/teklif/${quoteId}/faturaya-donustur`)
    check("fatura oluştu", conv.status === 201, conv.body?.invoiceNo)
    invoiceId = conv.body?.id
    if (!invoiceId) throw new Error("fatura id alınamadı: " + JSON.stringify(conv.body).slice(0, 300))
    const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { items: true } })
    check("faturada fatura altı iskonto 500", near(inv.globalDiscountAmount, 500), n(inv.globalDiscountAmount))
    check("fatura net/KDV/toplam teklifle aynı", near(inv.netAmount, 3800) && near(inv.vatAmount, 698.14) && near(inv.totalAmount, 4498.14), `${inv.netAmount} / ${inv.vatAmount} / ${inv.totalAmount}`)
    const ib = inv.items.find((i) => i.description === "TEST İskonto B")
    check("tutar iskontolu kalem faturada da oran NULL + tutar 50", ib?.discountRate === null && near(ib?.discountAmount, 50), `${n(ib?.discountRate)} / ${n(ib?.discountAmount)}`)

    // Fatura editörünün kuralıyla yeniden hesap (Σ satır neti − fatura altı iskonto,
    // KDV oransal): tekliften gelen faturayı editörde açınca rakam kaymamalı.
    const lineNet = inv.items.reduce((s, i) => s + Number(i.quantity) * Number(i.unitPrice) - Number(i.discountAmount || 0), 0)
    const lineVat = inv.items.reduce((s, i) => s + Number(i.vatAmount), 0)
    const factor = (lineNet - Number(inv.globalDiscountAmount)) / lineNet
    check("editör formülüyle KDV aynı çıkıyor", near(lineVat * factor, Number(inv.vatAmount)), (lineVat * factor).toFixed(2))

    const invPdf = await fetch(`${BASE}/api/faturalar/${invoiceId}/pdf?companyId=${company.id}`, { headers: { cookie } })
    check("fatura PDF'i üretildi", invPdf.status === 200, invPdf.status)
  } finally {
    console.log("\n7) Temizlik")
    if (invoiceId) {
      const del = await fetch(`${BASE}/api/e-donusum/invoices/${invoiceId}?companyId=${company.id}`, {
        method: "DELETE",
        headers: { cookie },
      })
      check("test faturası silindi", del.ok, `HTTP ${del.status}`)
    }
    if (quoteId) {
      const del = await fetch(`${BASE}/api/teklif/${quoteId}?companyId=${company.id}`, {
        method: "DELETE",
        headers: { cookie },
      })
      check("test teklifi silindi", del.ok, `HTTP ${del.status}`)
    }
    const leftover = await prisma.quote.count({ where: { companyId: company.id, notes: NOTES } })
    const leftoverItems = await prisma.invoiceItem.count({ where: { description: { startsWith: "TEST İskonto" } } })
    console.log(`  · kalan test teklifi: ${leftover} · kalan test fatura kalemi: ${leftoverItems}`)
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
