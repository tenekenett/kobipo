/**
 * "Satış yapıldığı anda pano güncellensin" doğrulaması.
 *
 * Fiş keser + tahsilat yazar, sonra panonun okuduğu yerden (transactions)
 * rakamın gerçekten oluştuğunu ölçer. Sonunda fişi iptal edip her şeyi geri alır.
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
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  ✓ ${label}${detail ? ` → ${detail}` : ""}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` → ${detail}` : ""}`) }
}

async function main() {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET
  const company = await prisma.company.findFirst({
    where: { name: { contains: "Demo Firma" } },
    select: { id: true, name: true },
  })
  const membership = await prisma.userCompany.findFirst({
    where: { companyId: company.id, role: "ADMIN" },
    select: { userId: true, user: { select: { email: true, isSuperAdmin: true } } },
  })
  const token = await encode({
    token: {
      id: membership.userId,
      email: membership.user.email,
      isSuperAdmin: membership.user.isSuperAdmin || false,
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
      headers: { cookie, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  }

  console.log(`Firma: ${company.name}\nSunucu: ${BASE}\n`)

  // Kasa yoksa test kendi kanalını açar ve sonunda siler: tahsilatın panoya
  // ulaşması için para girecek bir kanal şart.
  let account = await prisma.financialAccount.findFirst({
    where: { companyId: company.id, type: "CASH" },
    select: { id: true, name: true, balance: true },
  })
  let createdAccountId = null
  if (!account) {
    account = await prisma.financialAccount.create({
      data: { companyId: company.id, name: `TEST Kasa ${Date.now()}`, type: "CASH", balance: 0 },
      select: { id: true, name: true, balance: true },
    })
    createdAccountId = account.id
  }
  const product = await prisma.product.findFirst({
    where: { companyId: company.id, isService: false },
    select: { id: true, name: true },
  })
  console.log(`Kasa: ${account.name} · ürün: ${product.name}\n`)

  const before = {
    balance: Number(account.balance),
    income: Number(
      (await prisma.transaction.aggregate({
        where: { companyId: company.id, type: "INCOME" },
        _sum: { amount: true },
      }))._sum.amount ?? 0,
    ),
    trxCount: await prisma.transaction.count({ where: { companyId: company.id } }),
  }

  // ── Satış: fiş + tahsilat (Kahveci Satış / adisyon kapanışıyla aynı yol) ──
  console.log("1) Fiş + tahsilat")
  const inv = await api("POST", "/api/e-donusum/invoices", {
    companyId: company.id,
    type: "SALES",
    invoiceType: "MANUAL",
    isReceipt: true,
    date: new Date().toISOString(),
    currency: "TRY",
    sendInvoice: false,
    notes: `TEST pano ${Date.now()}`,
    items: [
      { productId: product.id, description: product.name, unit: "ADET", quantity: 1, unitPrice: 100, vatRate: 20 },
    ],
  })
  check("fiş kesildi", inv.status === 200 || inv.status === 201, inv.body?.invoiceNo)
  const total = Number(inv.body.totalAmount)

  const pay = await api("POST", "/api/faturalar/odemeler", {
    invoiceId: inv.body.id,
    companyId: company.id,
    amount: total,
    paymentMethod: "CASH",
    accountId: account.id,
    paymentDate: new Date().toISOString(),
  })
  check("tahsilat yazıldı", pay.status === 201, `${total} TL`)

  console.log("\n2) Panonun okuduğu yer (transactions)")
  check("tahsilat KASA HAREKETİ üretti", !!pay.body?.transactionId, pay.body?.transactionId ?? "yok")

  const trx = pay.body?.transactionId
    ? await prisma.transaction.findUnique({ where: { id: pay.body.transactionId } })
    : null
  check("hareket INCOME ve tutarı doğru", trx?.type === "INCOME" && Number(trx.amount) === total,
    `${trx?.type} · ${Number(trx?.amount ?? 0)}`)
  check("hareket kasaya bağlı", trx?.accountId === account.id, trx?.accountId)

  const after = {
    balance: Number((await prisma.financialAccount.findUnique({ where: { id: account.id } })).balance),
    income: Number(
      (await prisma.transaction.aggregate({
        where: { companyId: company.id, type: "INCOME" },
        _sum: { amount: true },
      }))._sum.amount ?? 0,
    ),
    trxCount: await prisma.transaction.count({ where: { companyId: company.id } }),
  }
  check("pano geliri satış kadar arttı", Math.abs(after.income - before.income - total) < 0.005,
    `${before.income} → ${after.income}`)
  check("kasa bakiyesi TEK kez arttı", Math.abs(after.balance - before.balance - total) < 0.005,
    `${before.balance} → ${after.balance}`)
  check("tek hareket yazıldı (çift kayıt yok)", after.trxCount === before.trxCount + 1,
    `${before.trxCount} → ${after.trxCount}`)

  // Pano sayfası gerçekten rakamı basıyor mu (HTML'de gelir toplamı)?
  const page = await fetch(`${BASE}/dashboard?company=${company.id}`, { headers: { cookie } })
  const html = await page.text()
  const expected = after.income.toLocaleString("tr-TR", { maximumFractionDigits: 0 })
  check("pano sayfası yeni geliri basıyor", html.includes(expected), `beklenen "₺${expected}"`)

  // ── Asıl mesele: pano ÖNBELLEKTEYKEN yapılan satış ─────────────────────────
  // Pano verisi 20 sn önbellekli. Etiket geçersizleştirmesi olmasaydı, panoya
  // bakan kasiyer satıştan sonra 20 sn eski rakamı görürdü.
  console.log("\n2b) Pano önbellekteyken yapılan satış anında görünüyor mu")
  await fetch(`${BASE}/dashboard?company=${company.id}`, { headers: { cookie } }) // önbelleği doldur

  const inv2 = await api("POST", "/api/e-donusum/invoices", {
    companyId: company.id,
    type: "SALES",
    invoiceType: "MANUAL",
    isReceipt: true,
    date: new Date().toISOString(),
    currency: "TRY",
    sendInvoice: false,
    notes: `TEST pano2 ${Date.now()}`,
    items: [
      { productId: product.id, description: product.name, unit: "ADET", quantity: 1, unitPrice: 50, vatRate: 20 },
    ],
  })
  const total2 = Number(inv2.body.totalAmount)
  await api("POST", "/api/faturalar/odemeler", {
    invoiceId: inv2.body.id,
    companyId: company.id,
    amount: total2,
    paymentMethod: "CASH",
    accountId: account.id,
    paymentDate: new Date().toISOString(),
  })

  const html2 = await (
    await fetch(`${BASE}/dashboard?company=${company.id}`, { headers: { cookie } })
  ).text()
  const expected2 = (after.income + total2).toLocaleString("tr-TR", { maximumFractionDigits: 0 })
  check(
    "önbellek dolu olmasına rağmen yeni satış panoda",
    html2.includes(expected2),
    `beklenen "₺${expected2}" (20 sn beklemeden)`,
  )
  check("yeni fiş 'Son faturalar' tablosunda", html2.includes(inv2.body.invoiceNo), inv2.body.invoiceNo)

  // İkinci fişi geri al (asıl ölçüm birinci fiş üzerinden sürüyor).
  await api("POST", `/api/fisler/${inv2.body.id}/iptal`, { companyId: company.id })
  await fetch(`${BASE}/api/e-donusum/invoices/${inv2.body.id}?companyId=${company.id}`, {
    method: "DELETE",
    headers: { cookie },
  })

  console.log("\n3) Fiş iptali her şeyi geri alıyor")
  const cancel = await api("POST", `/api/fisler/${inv.body.id}/iptal`, { companyId: company.id })
  check("fiş iptal edildi (kasa hareketli fiş kilitlemiyor)", cancel.status === 200, cancel.body?.error ?? cancel.body?.message)

  const final = {
    balance: Number((await prisma.financialAccount.findUnique({ where: { id: account.id } })).balance),
    trxCount: await prisma.transaction.count({ where: { companyId: company.id } }),
    income: Number(
      (await prisma.transaction.aggregate({
        where: { companyId: company.id, type: "INCOME" },
        _sum: { amount: true },
      }))._sum.amount ?? 0,
    ),
  }
  check("kasa bakiyesi geri döndü", Math.abs(final.balance - before.balance) < 0.005, `${final.balance}`)
  check("kasa hareketi silindi", final.trxCount === before.trxCount, `${final.trxCount}`)
  check("pano geliri eski değerine döndü", Math.abs(final.income - before.income) < 0.005, `${final.income}`)

  const leftPayments = await prisma.invoicePayment.count({ where: { invoiceId: inv.body.id } })
  check("tahsilat kaydı da temizlendi", leftPayments === 0, `${leftPayments} kayıt`)

  // Temizlik: iptal edilen fiş kaydını ve testin açtığı kasayı sil.
  await fetch(`${BASE}/api/e-donusum/invoices/${inv.body.id}?companyId=${company.id}`, {
    method: "DELETE",
    headers: { cookie },
  })
  if (createdAccountId) {
    await prisma.financialAccount.delete({ where: { id: createdAccountId } })
  }

  console.log(`\n${fail === 0 ? "TÜMÜ GEÇTİ" : "BAŞARISIZ"} — ${pass} geçti, ${fail} kaldı\n`)
  process.exitCode = fail === 0 ? 0 : 1
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
