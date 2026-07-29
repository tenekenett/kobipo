/**
 * Fiş kesme + tahsilat akışının birim testleri (lib/satis/submit-receipt-sale.ts).
 *
 * Çalıştırma:  node scripts/test-receipt-sale.mjs
 *
 * Bu modülü hem Kahveci Satış hem Adisyon kapanışı kullanıyor; bozulursa iki
 * ekranda birden yanlış tutar tahsil edilir. DB ve sunucu gerekmez — `fetch`
 * sahte bir uçla değiştirilir ve GİDEN İSTEKLER incelenir.
 *
 * En kritik kural burada test ediliyor: tahsilat tutarı istemcinin hesabından
 * DEĞİL, faturanın SUNUCUDA kayıtlı toplamından gelir. (Kuruş farkı ödemeyi
 * reddettirirdi — bkz. lib/satis/payment.ts başlığı.)
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const out = mkdtempSync(join(tmpdir(), "kobipo-sale-"))

const tsc = join(process.cwd(), "node_modules", "typescript", "bin", "tsc")
if (!existsSync(tsc)) {
  console.error("typescript bulunamadı — önce `npm install` çalıştırın.")
  process.exit(1)
}

// Alias'ları (@/lib/...) çözemediği için tsc hata koduyla döner ama JS'i üretir.
let tscOutput = ""
try {
  execFileSync(
    process.execPath,
    [
      tsc,
      "lib/satis/payment.ts",
      "lib/satis/submit-receipt-sale.ts",
      "--outDir", out,
      "--rootDir", "lib",
      "--module", "es2020",
      "--target", "es2020",
      "--moduleResolution", "node",
      "--skipLibCheck",
    ],
    { stdio: "pipe" },
  )
} catch (err) {
  tscOutput = `${err.stdout ?? ""}${err.stderr ?? ""}`
}

const modPath = join(out, "satis", "submit-receipt-sale.js")
if (!existsSync(modPath)) {
  console.error("tsc çıktı üretemedi:\n" + tscOutput)
  process.exit(1)
}

writeFileSync(
  modPath,
  readFileSync(modPath, "utf8").replace(/["']@\/lib\/satis\/payment["']/, '"./payment.js"'),
)
writeFileSync(join(out, "package.json"), '{"type":"module"}')

const { submitReceiptSale } = await import(pathToFileURL(modPath).href)
const { emptyPaymentState } = await import(pathToFileURL(join(out, "satis", "payment.js")).href)

let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) {
    pass++
    console.log(`  ✓ ${label}${detail ? ` → ${detail}` : ""}`)
  } else {
    fail++
    console.log(`  ✗ ${label}${detail ? ` → ${detail}` : ""}`)
  }
}

/** Sahte uç: giden istekleri kaydeder, verilen yanıtları sırayla döndürür. */
function stubFetch(responses) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null
    calls.push({ url, method: init?.method, body })
    const next = responses.shift() ?? { ok: true, status: 200, json: {} }
    return {
      ok: next.ok,
      status: next.status,
      json: async () => next.json,
    }
  }
  return calls
}

const ITEMS = [
  { productId: "p1", description: "Latte", unit: "ADET", quantity: 3, unitPrice: 85, vatRate: 20 },
]
const ACCOUNTS = [
  { id: "acc-cash", name: "Kasa", type: "CASH" },
  { id: "acc-bank", name: "Banka", type: "BANK" },
]

console.log("1) Nakit satış — tutar SUNUCUNUN toplamından gelir")
{
  // İstemcinin hesabı 306,004 (yuvarlanmamış); sunucu 306,00 yazmış.
  const calls = stubFetch([
    { ok: true, status: 200, json: { id: "inv1", invoiceNo: "FS-SAT-2026-0001", totalAmount: 306 } },
    { ok: true, status: 200, json: { id: "pay1" } },
  ])
  const res = await submitReceiptSale({
    companyId: "c1",
    items: ITEMS,
    payment: { ...emptyPaymentState("acc-cash"), method: "CASH", tendered: "306" },
    accounts: ACCOUNTS,
    fallbackTotal: 306.004,
  })

  check("sonuç başarılı", res.ok === true)
  check("fiş ucu çağrıldı", calls[0]?.url === "/api/e-donusum/invoices", calls[0]?.method)
  check("isReceipt + MANUAL + gönderim yok", calls[0]?.body?.isReceipt === true && calls[0]?.body?.invoiceType === "MANUAL" && calls[0]?.body?.sendInvoice === false)
  check("kalem net fiyatla gitti", calls[0]?.body?.items?.[0]?.unitPrice === 85)
  check(
    "tahsilat SUNUCU toplamı (306) — istemcinin 306,004'ü değil",
    calls[1]?.body?.amount === 306,
    String(calls[1]?.body?.amount),
  )
  check("nakit hesabı seçildi", calls[1]?.body?.accountId === "acc-cash")
  check("paidSum", res.ok && res.paidSum === 306, res.ok ? String(res.paidSum) : "")
}

console.log("\n2) Sunucu toplam döndürmezse istemcinin toplamı yuvarlanır")
{
  const calls = stubFetch([
    { ok: true, status: 200, json: { id: "inv2", invoiceNo: "FS-SAT-2026-0002" } },
    { ok: true, status: 200, json: { id: "pay2" } },
  ])
  const res = await submitReceiptSale({
    companyId: "c1",
    items: ITEMS,
    payment: { ...emptyPaymentState("acc-cash"), method: "CASH" },
    accounts: ACCOUNTS,
    fallbackTotal: 306.004,
  })
  check("yedek toplam 2 haneye yuvarlandı", res.ok && res.total === 306, res.ok ? String(res.total) : "")
  check("tahsilat da aynı", calls[1]?.body?.amount === 306)
}

console.log("\n3) Veresiye — tahsilat yazılmaz")
{
  const calls = stubFetch([
    { ok: true, status: 200, json: { id: "inv3", totalAmount: 306 } },
  ])
  const res = await submitReceiptSale({
    companyId: "c1",
    items: ITEMS,
    payment: { ...emptyPaymentState("acc-cash"), isCredit: true },
    accounts: ACCOUNTS,
    fallbackTotal: 306,
  })
  check("başarılı", res.ok === true)
  check("yalnız fiş çağrısı yapıldı", calls.length === 1, `${calls.length} çağrı`)
  check("tahsilat toplamı 0", res.ok && res.paidSum === 0)
}

console.log("\n4) Parçalı ödeme — her parça ayrı tahsilat")
{
  const calls = stubFetch([
    { ok: true, status: 200, json: { id: "inv4", totalAmount: 306 } },
    { ok: true, status: 200, json: { id: "pay-a" } },
    { ok: true, status: 200, json: { id: "pay-b" } },
  ])
  const res = await submitReceiptSale({
    companyId: "c1",
    items: ITEMS,
    payment: {
      ...emptyPaymentState("acc-cash"),
      splitMode: true,
      split: { CASH: "100", CREDIT_CARD: "206", BANK_TRANSFER: "" },
    },
    accounts: ACCOUNTS,
    fallbackTotal: 306,
  })
  const amounts = calls.slice(1).map((c) => c.body.amount)
  check("iki tahsilat yazıldı", calls.length === 3, `${calls.length - 1} tahsilat`)
  check("tutarlar toplam eder", amounts.reduce((a, b) => a + b, 0) === 306, amounts.join(" + "))
  check("paidSum toplamla aynı", res.ok && res.paidSum === 306)
}

console.log("\n5) Fiş oluşmazsa yan etki yok")
{
  const calls = stubFetch([{ ok: false, status: 400, json: { error: "Stok yetersiz" } }])
  const res = await submitReceiptSale({
    companyId: "c1",
    items: ITEMS,
    payment: { ...emptyPaymentState("acc-cash"), method: "CASH" },
    accounts: ACCOUNTS,
    fallbackTotal: 306,
  })
  check("stage = invoice", res.ok === false && res.stage === "invoice", res.error)
  check("tahsilat denenmedi", calls.length === 1)
}

console.log("\n6) Tahsilat hatasında fiş bilgisi GERİ DÖNER (fiş silinmez)")
{
  stubFetch([
    { ok: true, status: 200, json: { id: "inv6", invoiceNo: "FS-SAT-2026-0006", totalAmount: 306 } },
    { ok: false, status: 400, json: { error: "Kasa bulunamadı" } },
  ])
  const res = await submitReceiptSale({
    companyId: "c1",
    items: ITEMS,
    payment: { ...emptyPaymentState("acc-cash"), method: "CASH" },
    accounts: ACCOUNTS,
    fallbackTotal: 306,
  })
  check("stage = payment", res.ok === false && res.stage === "payment")
  check("fatura çağırana veriliyor", res.ok === false && res.invoice?.id === "inv6", "adisyon bunu kapatmak için kullanıyor")
}

console.log(`\n${fail === 0 ? "TÜMÜ GEÇTİ" : "BAŞARISIZ"} — ${pass} geçti, ${fail} kaldı`)
process.exitCode = fail === 0 ? 0 : 1
