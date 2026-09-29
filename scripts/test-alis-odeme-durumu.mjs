/**
 * Alış faturası ÖDEME DURUMU + STOK TAKİBİ + ÇALIŞAN MASRAF DEFTERİ — uçtan uca.
 * Kural: CLAUDE.md "Alış faturası: ödeme durumu + çalışan cebinden ödedi defteri".
 *
 * Çalıştırma:
 *   1) Migrasyon uygulanmış olmalı: 20260929000001_alis_odeme_durumu_calisan_defteri.sql
 *   2) npm run dev            (ayrı terminalde, http://localhost:3000)
 *   3) node scripts/test-alis-odeme-durumu.mjs
 *
 * Demo Firma A.Ş.'de TEST tedarikçi / ürün / çalışan açılır; her şey sonda API'den
 * silinir (ödemeler önce: fatura silinince kasa hareketi kendiliğinden geri alınmaz).
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
const today = new Date().toISOString().slice(0, 10)

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

  const C = company.id
  const stamp = Date.now().toString().slice(-6)
  const created = { supplierId: null, productId: null, employeeId: null, invoiceIds: [], reimbursementIds: [] }
  console.log(`Firma : ${company.name}\nSunucu: ${BASE}\n`)

  const accountBalance = async (id) =>
    Number((await prisma.financialAccount.findUnique({ where: { id }, select: { balance: true } })).balance)
  const productStock = async () =>
    Number((await prisma.product.findUnique({ where: { id: created.productId }, select: { stockQuantity: true } })).stockQuantity)
  const ledger = async () => (await api("GET", `/api/personel/masraf?companyId=${C}&employeeId=${created.employeeId}`)).body
  const purchase = (extra) => ({
    companyId: C,
    type: "PURCHASE",
    invoiceType: "MANUAL",
    supplierId: created.supplierId,
    date: today,
    currency: "TRY",
    sendInvoice: false,
    items: [
      { productId: created.productId, description: `TEST Ürün ${stamp}`, unit: "ADET", quantity: 3, unitPrice: 100, vatRate: 20, discountRate: 0 },
    ],
    ...extra,
  })

  try {
    console.log("0) Hazırlık")
    const sup = await api("POST", "/api/cari/suppliers", { companyId: C, name: `TEST Alış Ödeme ${stamp}` })
    created.supplierId = sup.body?.id
    const prod = await api("POST", "/api/stok/products", {
      companyId: C,
      name: `TEST Ürün ${stamp}`,
      code: `TST${stamp}`,
      unit: "ADET",
      purchasePrice: 100,
      salePrice: 150,
      vatRate: 20,
      isService: false,
    })
    created.productId = prod.body?.id
    const emp = await api("POST", "/api/personel/employees", { companyId: C, firstName: "TEST", lastName: `Çalışan ${stamp}` })
    created.employeeId = emp.body?.id
    check("tedarikçi/ürün/çalışan açıldı", sup.status === 201 && prod.status === 201 && emp.status === 201, `${sup.status}/${prod.status}/${emp.status} ${prod.body?.error ?? ""}`)
    const account = await prisma.financialAccount.findFirst({ where: { companyId: C, type: "CASH" }, select: { id: true, name: true } })
      ?? (await prisma.financialAccount.findFirst({ where: { companyId: C }, select: { id: true, name: true } }))
    check("kasa/banka hesabı var", Boolean(account), account?.name)

    console.log("\n1) Ödendi → kasadan tam tutar")
    const bal0 = await accountBalance(account.id)
    const stock0 = await productStock()
    const a = await api("POST", "/api/e-donusum/invoices", purchase({ purchasePayment: { status: "PAID", accountId: account.id } }))
    created.invoiceIds.push(a.body?.id)
    check("fatura 201", a.status === 201, `${a.status} ${a.body?.error ?? ""}`)
    check("yanıtta ödeme özeti, uyarı yok", Boolean(a.body?.payment) && !a.body?.paymentWarning, a.body?.paymentWarning)
    const payA = await prisma.invoicePayment.findMany({ where: { invoiceId: a.body.id }, include: { transaction: true } })
    check("tek ödeme = fatura toplamı", payA.length === 1 && near(payA[0].amount, a.body.totalAmount), `${payA.length} / ${payA[0]?.amount} ↔ ${a.body.totalAmount}`)
    check("ödeme kasa hareketi yazdı (EXPENSE, tedarikçi bağlı)", payA[0]?.transaction?.type === "EXPENSE" && payA[0]?.transaction?.supplierId === created.supplierId)
    check("kasa bakiyesi düştü", near(await accountBalance(account.id), bal0 - Number(a.body.totalAmount)))
    check("stok girdi (+3)", near(await productStock(), stock0 + 3))

    console.log("\n2) Çalışan cebinden + stok girişi yapılmasın")
    const stock1 = await productStock()
    const bal1 = await accountBalance(account.id)
    const b = await api("POST", "/api/e-donusum/invoices", purchase({ skipStock: true, purchasePayment: { status: "EMPLOYEE", employeeId: created.employeeId } }))
    created.invoiceIds.push(b.body?.id)
    const totalB = Number(b.body?.totalAmount)
    check("fatura 201", b.status === 201, `${b.status} ${b.body?.error ?? ""}`)
    check("skipStock kaydedildi", b.body?.skipStock === true)
    check("stok DEĞİŞMEDİ", near(await productStock(), stock1))
    check("kasa DEĞİŞMEDİ", near(await accountBalance(account.id), bal1))
    const payB = await prisma.invoicePayment.findMany({ where: { invoiceId: b.body.id }, include: { employeeLedger: true } })
    check("ödeme EMPLOYEE, kasasız, defter satırı var",
      payB.length === 1 && payB[0].paymentMethod === "EMPLOYEE" && !payB[0].accountId && !payB[0].transactionId && payB[0].employeeLedger?.kind === "EXPENSE")
    let L = await ledger()
    check("defter bakiyesi = fatura toplamı", near(L.balance, totalB), `${L.balance} ↔ ${totalB}`)

    console.log("\n3) Doğrulama fatura AÇILMADAN yapılır")
    const countBefore = await prisma.invoice.count({ where: { supplierId: created.supplierId } })
    const usd = await api("POST", "/api/e-donusum/invoices", purchase({ currency: "USD", exchangeRate: "40", purchasePayment: { status: "EMPLOYEE", employeeId: created.employeeId } }))
    check("dövizde çalışan cebinden → 400", usd.status === 400, usd.body?.error)
    const noEmp = await api("POST", "/api/e-donusum/invoices", purchase({ purchasePayment: { status: "EMPLOYEE", employeeId: "yok-boyle-biri" } }))
    check("olmayan çalışan → 404", noEmp.status === 404, noEmp.body?.error)
    const noSel = await api("POST", "/api/e-donusum/invoices", purchase({ purchasePayment: { status: "EMPLOYEE" } }))
    check("çalışan seçilmedi → 400", noSel.status === 400, noSel.body?.error)
    check("reddedilenler fatura AÇMADI", (await prisma.invoice.count({ where: { supplierId: created.supplierId } })) === countBefore)

    console.log("\n4) Çalışana öde — kasa düşer, kâr/zarar gideri DEĞİŞMEZ, nakit akışı fatura ödemesi sayar")
    const q = `companyId=${C}&startDate=${today}&endDate=${today}`
    const kz0 = (await api("GET", `/api/raporlar/kar-zarar?${q}`)).body
    const na0 = (await api("GET", `/api/raporlar/nakit-akisi?${q}`)).body
    const over = await api("POST", "/api/personel/masraf", { companyId: C, employeeId: created.employeeId, amount: totalB + 1, accountId: account.id, date: today })
    check("borçtan fazla ödeme → 400", over.status === 400, over.body?.error)
    const bal2 = await accountBalance(account.id)
    const pay = await api("POST", "/api/personel/masraf", { companyId: C, employeeId: created.employeeId, amount: totalB, accountId: account.id, date: today, notes: "test" })
    created.reimbursementIds.push(pay.body?.entryId)
    check("geri ödeme 201", pay.status === 201, `${pay.status} ${pay.body?.error ?? ""}`)
    check("kasa geri ödeme kadar düştü", near(await accountBalance(account.id), bal2 - totalB))
    const trx = await prisma.transaction.findUnique({ where: { id: pay.body.transactionId } })
    check("hareket CALISAN: önekli, carisiz", trx?.reference === `CALISAN:${created.employeeId}` && !trx.supplierId && !trx.customerId, trx?.reference)
    L = await ledger()
    check("defter bakiyesi 0", near(L.balance, 0), String(L.balance))
    const kz1 = (await api("GET", `/api/raporlar/kar-zarar?${q}`)).body
    const na1 = (await api("GET", `/api/raporlar/nakit-akisi?${q}`)).body
    check("kâr/zarar diğer giderler değişmedi (gider faturada)", near(kz1.otherExpenses, kz0.otherExpenses), `${kz0.otherExpenses} → ${kz1.otherExpenses}`)
    check("nakit akışı: fatura ödemeleri +tutar", near(na1.operatingActivities.payments - na0.operatingActivities.payments, totalB),
      `${na0.operatingActivities.payments} → ${na1.operatingActivities.payments}`)
    check("nakit akışı: diğer giderler değişmedi", near(na1.operatingActivities.otherExpense, na0.operatingActivities.otherExpense))

    console.log("\n5) Bilanço: borç açıkken personele borç satırı")
    const rev = await api("DELETE", `/api/personel/masraf/${pay.body.entryId}?companyId=${C}`)
    created.reimbursementIds = []
    check("geri ödeme geri alındı", rev.status === 200, rev.body?.error)
    check("kasa geri yazıldı", near(await accountBalance(account.id), bal2))
    check("hareket silindi", !(await prisma.transaction.findUnique({ where: { id: pay.body.transactionId } })))
    L = await ledger()
    check("borç yeniden açık", near(L.balance, totalB))
    const bil = (await api("GET", `/api/raporlar/bilanco?companyId=${C}`)).body
    check("bilanço personele borç ≥ açık borç, denk", Number(bil.liabilities?.employeePayables) >= totalB - 0.01 && near(bil.total, bil.totalLiabilitiesAndEquity),
      `${bil.liabilities?.employeePayables}`)

    console.log("\n6) Düzenlemede stok seçimi")
    const s0 = await productStock()
    const on = await api("PUT", `/api/e-donusum/invoices/${b.body.id}?companyId=${C}`, { skipStock: false })
    check("PUT skipStock=false 200", on.status === 200, on.body?.error)
    check("stok yazıldı (+3)", near(await productStock(), s0 + 3))
    const off = await api("PUT", `/api/e-donusum/invoices/${b.body.id}?companyId=${C}`, { skipStock: true })
    check("PUT skipStock=true 200", off.status === 200, off.body?.error)
    check("stok geri alındı", near(await productStock(), s0))
    check("bayrak kayıtta", (await prisma.invoice.findUnique({ where: { id: b.body.id }, select: { skipStock: true } })).skipStock === true)

    console.log("\n7) Ekstre ve ödeme listesi kimin ödediğini söyler")
    const pl = (await api("GET", `/api/faturalar/odemeler?companyId=${C}&invoiceId=${b.body.id}`)).body
    check("ödeme listesinde çalışan adı", pl?.[0]?.employeeLedger?.employee?.lastName === `Çalışan ${stamp}`)
    const sd = (await api("GET", `/api/cari/suppliers/${created.supplierId}?companyId=${C}`)).body
    const sBalance = Number(sd?.balance ?? sd?.supplier?.balance ?? NaN)
    check("tedarikçi bakiyesi 0 (iki fatura da ödendi)", near(sBalance, 0), String(sBalance))

    console.log("\n8) Defteri olan çalışan silinemez")
    const delEmp = await api("DELETE", `/api/personel/employees/${created.employeeId}?companyId=${C}`)
    check("çalışan silme → 409", delEmp.status === 409, delEmp.body?.error)
  } finally {
    console.log("\nTemizlik")
    for (const id of created.reimbursementIds.filter(Boolean)) {
      await api("DELETE", `/api/personel/masraf/${id}?companyId=${C}`)
    }
    for (const id of created.invoiceIds.filter(Boolean)) {
      const pays = await prisma.invoicePayment.findMany({ where: { invoiceId: id }, select: { id: true } })
      for (const p of pays) await api("DELETE", `/api/faturalar/odemeler/${p.id}`)
      const d = await api("DELETE", `/api/e-donusum/invoices/${id}?companyId=${C}`)
      console.log(`  fatura ${id}: ${d.status}`)
    }
    if (created.employeeId) console.log(`  çalışan: ${(await api("DELETE", `/api/personel/employees/${created.employeeId}?companyId=${C}`)).status}`)
    if (created.productId) console.log(`  ürün: ${(await api("DELETE", `/api/stok/products/${created.productId}?companyId=${C}`)).status}`)
    if (created.supplierId) console.log(`  tedarikçi: ${(await api("DELETE", `/api/cari/suppliers/${created.supplierId}?companyId=${C}`)).status}`)
    await prisma.$disconnect()
  }

  console.log(`\n${pass} geçti, ${fail} kaldı`)
  if (fail) {
    console.log("Kalanlar:\n  - " + failures.join("\n  - "))
    process.exit(1)
  }
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
