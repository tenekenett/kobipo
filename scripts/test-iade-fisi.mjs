/**
 * Hızlı Satış "İade modu" uçtan uca testi — satış İADE FİŞİ (RETURN + SALES yönü).
 *
 * Çalıştırma:
 *   1) npm run dev            (ayrı terminalde, http://localhost:3000)
 *   2) node scripts/test-iade-fisi.mjs
 *
 * Ölçülenler: iade fişi FS-IAD numarası alır, stok GİRER, nakit iade kasadan
 * ÇIKAR (EXPENSE), cariye alacak yazılan iade müşterinin bakiyesini DÜŞÜRÜR,
 * Satış Fişleri listesi/detayı iadeyi "isReturn" ile verir, iade fişi faturaya
 * DÖNÜŞTÜRÜLMEZ, iptal stok ve kasayı geri alır. Ayrıca fiş altı iskontolu satış
 * fişi (toplam/KDV) ve Hızlı Alış fişi (FS-ALI, kasadan çıkış) ölçülür.
 *
 * Demo Firma'da çalışır; açtığı fişleri iptal edip siler. Bitişte stok, kasa ve
 * cari bakiyesinin başlangıçla aynı olduğunu da ölçer.
 */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
import { PrismaClient } from "@prisma/client"
import { encode } from "next-auth/jwt"

loadEnv({ path: ".env.local", override: true })

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000"
const prisma = new PrismaClient()

let pass = 0
let fail = 0
const failures = []
function check(label, ok, detail) {
  if (ok) {
    pass++
    console.log(`  ✓ ${label}${detail ? ` → ${detail}` : ""}`)
  } else {
    fail++
    failures.push(label)
    console.log(`  ✗ ${label}${detail ? ` → ${detail}` : ""}`)
  }
}
const near = (a, b, tol = 0.011) => Math.abs(Number(a) - Number(b)) <= tol

const created = []

async function main() {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET
  const company = await prisma.company.findFirst({
    where: { name: { contains: "Demo Firma" } },
    select: { id: true, name: true },
  })
  if (!company) throw new Error("Demo Firma bulunamadı")
  const membership = await prisma.userCompany.findFirst({
    where: { companyId: company.id, role: "ADMIN" },
    select: { userId: true, user: { select: { email: true } } },
  })
  if (!membership) throw new Error("Demo Firma'da ADMIN üye yok")

  const product = await prisma.product.findFirst({
    where: { companyId: company.id, isActive: true, isService: false },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  })
  if (!product) throw new Error("Demo Firma'da stoklu ürün yok")
  const warehouse = await prisma.warehouse.findFirst({
    where: { companyId: company.id, isDefault: true },
    select: { id: true, name: true },
  })
  if (!warehouse) throw new Error("Demo Firma'da varsayılan depo yok")
  const cash = await prisma.financialAccount.findFirst({
    where: { companyId: company.id, type: "CASH", isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
  if (!cash) throw new Error("Demo Firma'da kasa yok")
  const customer = await prisma.customer.findFirst({
    where: { companyId: company.id },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  })
  if (!customer) throw new Error("Demo Firma'da müşteri yok")

  const token = await encode({
    token: {
      id: membership.userId,
      email: membership.user.email,
      isSuperAdmin: false,
      isBlogEditor: false,
      defaultCompanyId: company.id,
      defaultRole: "ADMIN",
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

  const stockOf = async () => {
    const [p, ws] = await Promise.all([
      prisma.product.findUnique({ where: { id: product.id }, select: { stockQuantity: true } }),
      prisma.warehouseStock.findUnique({
        where: { warehouseId_productId: { warehouseId: warehouse.id, productId: product.id } },
        select: { quantity: true },
      }),
    ])
    return { total: Number(p?.stockQuantity ?? 0), wh: Number(ws?.quantity ?? 0) }
  }
  const cashBalance = async () =>
    Number((await prisma.financialAccount.findUnique({ where: { id: cash.id }, select: { balance: true } })).balance)
  const customerBalance = async () => {
    const r = await api("GET", `/api/cari/customers/${customer.id}?companyId=${company.id}`)
    if (r.status !== 200) throw new Error(`cari kartı okunamadı: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
    return Number(r.body.balance)
  }

  const returnBody = (extra = {}) => ({
    companyId: company.id,
    type: "RETURN",
    returnKind: "SALES",
    invoiceType: "MANUAL",
    isReceipt: true,
    warehouseId: warehouse.id,
    date: new Date().toISOString(),
    currency: "TRY",
    sendInvoice: false,
    notes: "TEST iade fişi — test-iade-fisi.mjs",
    items: [{ productId: product.id, description: product.name, unit: "ADET", quantity: 2, unitPrice: 100, vatRate: 20 }],
    ...extra,
  })

  console.log(`Firma: ${company.name} · Ürün: ${product.name} · Depo: ${warehouse.name} · Kasa: ${cash.name}`)

  const stock0 = await stockOf()
  const cash0 = await cashBalance()
  const cust0 = await customerBalance()

  // ── 1) Perakende iade, nakit ödeme ─────────────────────────────────────────
  console.log("\n1) Perakende iade — nakit müşteriye ödenir")
  const r1 = await api("POST", "/api/e-donusum/invoices", returnBody())
  check("iade fişi oluştu", r1.status === 201, `${r1.status} ${r1.body.error ?? ""}`)
  if (r1.status !== 201) return
  created.push(r1.body.id)
  check("numara FS-IAD-", String(r1.body.invoiceNo).startsWith("FS-IAD-"), r1.body.invoiceNo)
  check("tip RETURN + SALES yönü", r1.body.type === "RETURN" && r1.body.returnKind === "SALES")
  check("toplam 240 (2 × 100 + %20)", near(r1.body.totalAmount, 240), String(r1.body.totalAmount))
  check("stok uyarısı yok", !r1.body.stockWarning, r1.body.stockWarning)

  const stock1 = await stockOf()
  check("stok 2 GİRDİ (ürün toplamı)", near(stock1.total - stock0.total, 2, 0.0001), `${stock0.total} → ${stock1.total}`)
  check("stok 2 GİRDİ (seçilen depo)", near(stock1.wh - stock0.wh, 2, 0.0001), `${stock0.wh} → ${stock1.wh}`)

  const pay1 = await api("POST", "/api/faturalar/odemeler", {
    invoiceId: r1.body.id,
    companyId: company.id,
    amount: 240,
    paymentMethod: "CASH",
    accountId: cash.id,
    paymentDate: new Date().toISOString(),
  })
  check("iade ödemesi yazıldı", pay1.status === 201 || pay1.status === 200, `${pay1.status} ${pay1.body.error ?? ""}`)
  const cash1 = await cashBalance()
  check("kasa 240 AZALDI", near(cash0 - cash1, 240), `${cash0} → ${cash1}`)
  const trx = pay1.body.transactionId
    ? await prisma.transaction.findUnique({ where: { id: pay1.body.transactionId }, select: { type: true } })
    : null
  check("kasa hareketi GİDER (EXPENSE)", trx?.type === "EXPENSE", trx?.type)

  // ── 2) Liste / detay / dönüştürme kapısı ───────────────────────────────────
  console.log("\n2) Satış Fişleri listesi ve detay")
  const list = await api("GET", `/api/fisler?companyId=${company.id}&direction=outgoing`)
  const row = (list.body.rows ?? []).find((r) => r.id === r1.body.id)
  check("listede görünüyor", Boolean(row))
  check("isReturn = true", row?.isReturn === true)
  check("ödeme durumu PAID (iade edildi)", row?.paymentStatus === "PAID", row?.paymentStatus)
  const salesRow = (list.body.rows ?? []).find((r) => !r.isReturn)
  if (salesRow) check("satış fişleri isReturn = false", salesRow.isReturn === false)

  const detail = await api("GET", `/api/fisler/${r1.body.id}?companyId=${company.id}`)
  check("detay açıldı", detail.status === 200, String(detail.status))
  check("detay: satış tarafı (outgoing)", detail.body.direction === "outgoing", detail.body.direction)
  check("detay: isReturn", detail.body.isReturn === true)
  check("detay: yazarkasa alanı yok", detail.body.okc === null)

  const conv = await api("POST", "/api/fisler/faturaya-donustur", { companyId: company.id, receiptIds: [r1.body.id] })
  check("faturaya dönüştürme REDDEDİLDİ", conv.status === 400, `${conv.status} ${conv.body.error ?? ""}`)

  // ── 3) İptal stok ve kasayı geri alır ─────────────────────────────────────
  console.log("\n3) İptal")
  const cancel1 = await api("POST", `/api/fisler/${r1.body.id}/iptal`, { companyId: company.id })
  check("iptal edildi", cancel1.status === 200, `${cancel1.status} ${cancel1.body.error ?? ""}`)
  const stock2 = await stockOf()
  check("stok eski hâline döndü", near(stock2.total, stock0.total, 0.0001) && near(stock2.wh, stock0.wh, 0.0001), `${stock2.total} / ${stock2.wh}`)
  const cash2 = await cashBalance()
  check("kasa eski hâline döndü", near(cash2, cash0), `${cash0} → ${cash2}`)

  // ── 4) Cariye alacak (ödeme yok) ──────────────────────────────────────────
  console.log("\n4) Müşterili iade — ödeme yok, alacağa yazılır")
  const r2 = await api("POST", "/api/e-donusum/invoices", returnBody({ customerId: customer.id }))
  check("iade fişi oluştu", r2.status === 201, `${r2.status} ${r2.body.error ?? ""}`)
  if (r2.status !== 201) return
  created.push(r2.body.id)
  const cust1 = await customerBalance()
  check("müşteri bakiyesi 240 DÜŞTÜ", near(cust0 - cust1, 240), `${cust0} → ${cust1}`)
  const cancel2 = await api("POST", `/api/fisler/${r2.body.id}/iptal`, { companyId: company.id })
  check("iptal edildi", cancel2.status === 200, `${cancel2.status} ${cancel2.body.error ?? ""}`)
  const cust2 = await customerBalance()
  check("müşteri bakiyesi eski hâline döndü", near(cust2, cust0), `${cust0} → ${cust2}`)

  // ── 5) Fiş altı iskonto (Hızlı Satış) ────────────────────────────────────
  // Ekran 24 TL (KDV dahil) iskontoyu NET 20 olarak gönderir (lib/satis/ticket-discount.ts).
  console.log("\n5) İskontolu satış fişi — 240 TL'den 24 TL iskonto")
  const r5 = await api("POST", "/api/e-donusum/invoices", {
    ...returnBody(),
    type: "SALES",
    returnKind: undefined,
    globalDiscountAmount: 20,
    notes: "TEST iskontolu satış — test-iade-fisi.mjs",
  })
  if (r5.status === 400 && /İskonto/.test(String(r5.body.error))) {
    check("iskonto tavanı (firma ayarı) reddetti — tutar kontrolü atlandı", true, r5.body.error)
  } else {
    check("satış fişi oluştu", r5.status === 201, `${r5.status} ${r5.body.error ?? ""}`)
    if (r5.status === 201) {
      created.push(r5.body.id)
      check("toplam 216 (240 − 24)", near(r5.body.totalAmount, 216), String(r5.body.totalAmount))
      check("KDV 36 (40 − 4)", near(r5.body.vatAmount, 36), String(r5.body.vatAmount))
      const stock5 = await stockOf()
      check("satış stoğu 2 düşürdü", near(stock0.total - stock5.total, 2, 0.0001), `${stock0.total} → ${stock5.total}`)
      const c5 = await api("POST", `/api/fisler/${r5.body.id}/iptal`, { companyId: company.id })
      check("iptal edildi", c5.status === 200, `${c5.status} ${c5.body.error ?? ""}`)
    }
  }

  // ── 6) Hızlı Alış — tedarikçili alış fişi, nakit ödeme ───────────────────
  console.log("\n6) Alış fişi — nakit ödeme (tedarikçi varsa onunla)")
  const supplier = await prisma.supplier.findFirst({
    where: { companyId: company.id },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  })
  // Tedarikçi yoksa serbest alış (tedarikçisiz) — Hızlı Alış ikisini de keser.
  {
    const r6 = await api("POST", "/api/e-donusum/invoices", {
      ...returnBody(),
      type: "PURCHASE",
      returnKind: undefined,
      supplierId: supplier?.id ?? null,
      notes: "TEST alış fişi — test-iade-fisi.mjs",
    })
    check("alış fişi oluştu", r6.status === 201, `${r6.status} ${r6.body.error ?? ""}`)
    if (r6.status === 201) {
      created.push(r6.body.id)
      check("numara FS-ALI-", String(r6.body.invoiceNo).startsWith("FS-ALI-"), r6.body.invoiceNo)
      const cashBefore = await cashBalance()
      const p6 = await api("POST", "/api/faturalar/odemeler", {
        invoiceId: r6.body.id,
        companyId: company.id,
        amount: Number(r6.body.totalAmount),
        paymentMethod: "CASH",
        accountId: cash.id,
        paymentDate: new Date().toISOString(),
      })
      check("alış ödemesi yazıldı", p6.status === 201 || p6.status === 200, `${p6.status} ${p6.body.error ?? ""}`)
      const cashAfter = await cashBalance()
      check("kasa alış tutarı kadar AZALDI", near(cashBefore - cashAfter, Number(r6.body.totalAmount)), `${cashBefore} → ${cashAfter}`)
      const list6 = await api("GET", `/api/fisler?companyId=${company.id}&direction=incoming`)
      check("Alış Fişleri listesinde", (list6.body.rows ?? []).some((r) => r.id === r6.body.id))
      const c6 = await api("POST", `/api/fisler/${r6.body.id}/iptal`, { companyId: company.id })
      check("iptal edildi", c6.status === 200, `${c6.status} ${c6.body.error ?? ""}`)
    }
  }

  const stockEnd = await stockOf()
  check("SON: stok başlangıçla aynı", near(stockEnd.total, stock0.total, 0.0001), `${stock0.total} → ${stockEnd.total}`)
  const cashEnd = await cashBalance()
  check("SON: kasa başlangıçla aynı", near(cashEnd, cash0), `${cash0} → ${cashEnd}`)
}

async function cleanup() {
  if (created.length === 0) return
  console.log("\nTemizlik")
  const company = await prisma.company.findFirst({ where: { name: { contains: "Demo Firma" } }, select: { id: true } })
  const membership = await prisma.userCompany.findFirst({
    where: { companyId: company.id, role: "ADMIN" },
    select: { userId: true, user: { select: { email: true } } },
  })
  const token = await encode({
    token: { id: membership.userId, email: membership.user.email, isSuperAdmin: false, isBlogEditor: false, defaultCompanyId: company.id, defaultRole: "ADMIN" },
    secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET,
  })
  const cookie = `next-auth.session-token=${token}`
  for (const id of created) {
    // İptal edilmemişse önce iptal (stok/kasa geri alınır), sonra fiziksel silme.
    const inv = await prisma.invoice.findUnique({ where: { id }, select: { status: true } })
    if (inv && inv.status !== "CANCELLED") {
      await fetch(`${BASE}/api/fisler/${id}/iptal`, {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: company.id }),
      })
    }
    const del = await fetch(`${BASE}/api/e-donusum/invoices/${id}?companyId=${company.id}`, {
      method: "DELETE",
      headers: { cookie },
    })
    console.log(`  ${del.ok ? "✓" : "✗"} ${id} silindi (${del.status})`)
  }
  const left = await prisma.invoice.count({ where: { id: { in: created } } })
  check("açılan fiş kalmadı", left === 0, String(left))
}

try {
  await main()
} catch (e) {
  fail++
  failures.push(String(e?.message || e))
  console.error("HATA:", e)
} finally {
  try {
    await cleanup()
  } catch (e) {
    console.error("Temizlik hatası:", e)
    fail++
  }
  await prisma.$disconnect()
  console.log(`\n${fail === 0 ? "TÜMÜ GEÇTİ" : "BAŞARISIZ"} — ${pass} geçti, ${fail} kaldı`)
  if (failures.length) console.log("Kalanlar:", failures.join(" | "))
  process.exitCode = fail === 0 ? 0 : 1
}
