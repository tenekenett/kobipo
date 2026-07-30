/**
 * Ödeme kutusu mantığının birim testleri (lib/satis/payment.ts).
 *
 * Çalıştırma:  node scripts/test-payment.mjs
 *
 * Modül SAF ve bağımsız (import'u yok), o yüzden tek dosya tsc ile geçici bir
 * klasöre derlenip doğrudan çalıştırılıyor — DB, ağ veya Next.js gerekmez.
 * Aynı desen: scripts/test-recipe-expand.mjs
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, existsSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const out = mkdtempSync(join(tmpdir(), "kobipo-payment-"))

try {
  // .cmd spawn edilemediği için npx yerine tsc doğrudan Node ile çağrılıyor.
  const tsc = join(process.cwd(), "node_modules", "typescript", "bin", "tsc")
  if (!existsSync(tsc)) {
    console.error("typescript bulunamadı — önce `npm install` çalıştırın.")
    process.exit(1)
  }

  let tscOutput = ""
  try {
    execFileSync(
      process.execPath,
      [
        tsc,
        "lib/satis/payment.ts",
        "--outDir", out,
        "--rootDir", "lib",
        "--module", "es2020",
        "--target", "es2020",
        "--moduleResolution", "node",
        "--skipLibCheck",
      ],
      { stdio: "pipe" }
    )
  } catch (err) {
    tscOutput = `${err.stdout ?? ""}${err.stderr ?? ""}`
  }

  const modPath = join(out, "satis", "payment.js")
  if (!existsSync(modPath)) {
    console.error("tsc çıktı üretemedi:\n" + tscOutput)
    process.exit(1)
  }
  writeFileSync(join(out, "package.json"), '{"type":"module"}')

  const {
    buildPaymentParts,
    paymentSummary,
    parseAmount,
    portionsTotal,
    splitEqually,
    paymentLabelOf,
    emptyPaymentState,
  } = await import(pathToFileURL(modPath).href)

  let pass = 0
  let fail = 0
  const eq = (label, actual, expected) => {
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
      pass++
      console.log(`  OK   ${label} = ${JSON.stringify(actual)}`)
    } else {
      fail++
      console.log(
        `  FAIL ${label}\n       beklenen: ${JSON.stringify(expected)}\n       gelen:    ${JSON.stringify(actual)}`
      )
    }
  }

  const state = (patch = {}) => ({ ...emptyPaymentState("kasa1"), ...patch })
  const accounts = { cashAccountId: "kasa1", bankAccountId: "banka1" }

  console.log("\n== Tutar ayrıştırma ==")
  eq("virgüllü giriş", parseAmount("12,50"), 12.5)
  eq("noktalı giriş", parseAmount("12.50"), 12.5)
  eq("boş giriş", parseAmount(""), 0)
  eq("çöp giriş", parseAmount("abc"), 0)
  eq(
    "portionsTotal",
    portionsTotal([
      { id: "1", method: "CASH", amount: "10,5" },
      { id: "2", method: "CREDIT_CARD", amount: "20" },
      { id: "3", method: "BANK_TRANSFER", amount: "" },
    ]),
    30.5,
  )

  console.log("\n== Tek yöntem: nakit ==")
  const cash = state({ method: "CASH", tendered: "100" })
  eq("tahsilat tutarın tamamı", buildPaymentParts(cash, { total: 85, ...accounts }), [
    { method: "CASH", amount: 85, accountId: "kasa1" },
  ])
  const cashSum = paymentSummary(cash, 85)
  eq("verilen 100", cashSum.tendered, 100)
  eq("para üstü 15", cashSum.change, 15)
  eq("açık kalmadı", cashSum.remaining, 0)

  console.log("\n== Tek yöntem: kart (para üstü yok) ==")
  const card = state({ method: "CREDIT_CARD" })
  eq("kart tahsilatı", buildPaymentParts(card, { total: 85, ...accounts }), [
    { method: "CREDIT_CARD", amount: 85, accountId: "kasa1" },
  ])
  eq("kartta para üstü yok", paymentSummary(card, 85).change, 0)

  console.log("\n== Veresiye ==")
  const credit = state({ isCredit: true })
  eq("tahsilat yazılmaz", buildPaymentParts(credit, { total: 85, ...accounts }), [])
  eq("tamamı açık kalır", paymentSummary(credit, 85).remaining, 85)

  console.log("\n== Parçalı ödeme (parça listesi) ==")
  let seq = 0
  const portion = (method, amount, provider) => ({
    id: `t${++seq}`,
    method,
    amount,
    ...(provider ? { provider } : {}),
  })
  const split = (portions) => state({ splitMode: true, portions })

  const exact = split([portion("CREDIT_CARD", "60"), portion("CASH", "40")])
  eq("kart önce, nakit sonra", buildPaymentParts(exact, { total: 100, ...accounts }), [
    { method: "CREDIT_CARD", amount: 60, provider: undefined, accountId: "banka1" },
    { method: "CASH", amount: 40, provider: undefined, accountId: "kasa1" },
  ])
  eq("tam ödendi", paymentSummary(exact, 100).remaining, 0)

  // Eski model yönteme ANAHTARLI idi: iki kredi kartı tek satıra çöküyordu.
  // Kafede en sık bölme biçimi bu — iki ayrı çekim, iki ayrı tahsilat satırı.
  const twoCards = split([portion("CREDIT_CARD", "50"), portion("CREDIT_CARD", "50")])
  eq("iki kredi kartı AYRI satır", buildPaymentParts(twoCards, { total: 100, ...accounts }), [
    { method: "CREDIT_CARD", amount: 50, provider: undefined, accountId: "banka1" },
    { method: "CREDIT_CARD", amount: 50, provider: undefined, accountId: "banka1" },
  ])

  const mealCards = split([
    portion("MEAL_CARD", "60", "Multinet"),
    portion("MEAL_CARD", "40", "Sodexo (Pluxee)"),
  ])
  eq("yemek kartı sağlayıcıları ayrı", buildPaymentParts(mealCards, { total: 100, ...accounts }), [
    { method: "MEAL_CARD", amount: 60, provider: "Multinet", accountId: "banka1" },
    { method: "MEAL_CARD", amount: 40, provider: "Sodexo (Pluxee)", accountId: "banka1" },
  ])
  eq("etiket sağlayıcıyı taşır", paymentLabelOf("MEAL_CARD", "Multinet"), "Yemek Kartı (Multinet)")
  eq("sağlayıcısız yöntemde sade etiket", paymentLabelOf("CREDIT_CARD"), "Kredi Kartı")

  // Nakit fazlası para üstüdür: kart gerçekten çekildiği için kırpılmamalı,
  // kırpma NAKİTTEN yapılır.
  const overCash = split([portion("CREDIT_CARD", "60"), portion("CASH", "60")])
  eq("nakit kırpılır (60 -> 40)", buildPaymentParts(overCash, { total: 100, ...accounts }), [
    { method: "CREDIT_CARD", amount: 60, provider: undefined, accountId: "banka1" },
    { method: "CASH", amount: 40, provider: undefined, accountId: "kasa1" },
  ])
  eq("para üstü 20", paymentSummary(overCash, 100).change, 20)
  eq("kaydedilen tahsilat tutarı aşmaz", paymentSummary(overCash, 100).paid, 100)

  const under = split([portion("CASH", "40")])
  eq("eksik ödeme olduğu gibi yazılır", buildPaymentParts(under, { total: 100, ...accounts }), [
    { method: "CASH", amount: 40, provider: undefined, accountId: "kasa1" },
  ])
  eq("kalan 60 açık hesap", paymentSummary(under, 100).remaining, 60)

  eq(
    "sıfır/boş satırlar atlanır",
    buildPaymentParts(split([portion("CASH", "100"), portion("BANK_TRANSFER", "0")]), {
      total: 100,
      ...accounts,
    }),
    [{ method: "CASH", amount: 100, provider: undefined, accountId: "kasa1" }],
  )
  eq(
    "toplam 0 ise tahsilat yok",
    buildPaymentParts(split([portion("CASH", "50")]), { total: 0, ...accounts }),
    [],
  )
  eq(
    "hesap bulunamazsa seçili hesaba düşer",
    buildPaymentParts(split([portion("BANK_TRANSFER", "50")]), { total: 50 }),
    [{ method: "BANK_TRANSFER", amount: 50, provider: undefined, accountId: "kasa1" }],
  )

  console.log("\n== Eşit bölme ==")
  eq("ikiye bölünür", splitEqually(100, 2), ["50.00", "50.00"])
  // Kuruş farkı İLK parçaya yüklenir; aksi halde hesap 1 kuruş açık kalırdı.
  eq("üçe bölmede kuruş ilk parçada", splitEqually(100, 3), ["33.34", "33.33", "33.33"])
  eq(
    "eşit bölme toplamı korur",
    splitEqually(100, 3).reduce((s, v) => s + parseFloat(v), 0),
    100,
  )

  console.log("\n== Kuruş yuvarlama ==")
  eq(
    "küsuratlı parçalar kırpılmadan yazılır",
    buildPaymentParts(split([portion("CASH", "0,1"), portion("CREDIT_CARD", "0,2")]), {
      total: 0.3,
      ...accounts,
    }),
    [
      { method: "CREDIT_CARD", amount: 0.2, provider: undefined, accountId: "banka1" },
      { method: "CASH", amount: 0.1, provider: undefined, accountId: "kasa1" },
    ],
  )
  eq(
    "kart+nakit toplamı 0,3'ü aşmaz",
    paymentSummary(split([portion("CASH", "0,1"), portion("CREDIT_CARD", "0,2")]), 0.3).paid,
    0.3,
  )

  console.log(`\n${fail === 0 ? "TÜMÜ GEÇTİ" : "BAŞARISIZ"} — ${pass} geçti, ${fail} kaldı\n`)
  process.exit(fail === 0 ? 0 : 1)
} finally {
  rmSync(out, { recursive: true, force: true })
}
