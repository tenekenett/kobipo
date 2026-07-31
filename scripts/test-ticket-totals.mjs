/**
 * Adisyon toplamı ve kalem durumlarının birim testleri
 * (lib/restoran/ticket-constants.ts).
 *
 * Çalıştırma:  node scripts/test-ticket-totals.mjs
 *
 * Modül SAF (Prisma/DB bağı yok), o yüzden tek dosya tsc ile geçici bir klasöre
 * derlenip doğrudan çalıştırılıyor. Aynı desen: scripts/test-payment.mjs
 *
 * Neden bu testler: ikram/zayi hesabı ve iskonto matrah çevrimi PARA hesabıdır —
 * yanlışı sessizce yanlış fiş keser.
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const out = mkdtempSync(join(tmpdir(), "kobipo-ticket-"))

try {
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
        "lib/restoran/ticket-constants.ts",
        // Seçenek reçete etkisinin tek tanımı genişletme çekirdeğinde
        // (parseRecipeEffects); o da birim dönüşümünü kullanıyor.
        "lib/stock/recipe-expand.ts",
        "lib/data/units.ts",
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

  const modPath = join(out, "restoran", "ticket-constants.js")
  if (!existsSync(modPath)) {
    console.error("tsc çıktı üretemedi:\n" + tscOutput)
    process.exit(1)
  }
  // tsc "@/..." alias'ını çözmüyor; emit edilen dosyalarda göreli yola çeviriyoruz.
  const rewrite = (file, from, to) =>
    writeFileSync(file, readFileSync(file, "utf8").replace(from, to))
  rewrite(modPath, /["']@\/lib\/stock\/recipe-expand["']/, '"../stock/recipe-expand.js"')
  rewrite(
    join(out, "stock", "recipe-expand.js"),
    /["']@\/lib\/data\/units["']/,
    '"../data/units.js"',
  )
  writeFileSync(join(out, "package.json"), '{"type":"module"}')

  const {
    ticketTotals,
    ticketDiscountOf,
    isBillableItem,
    consumesStock,
    parseItemOptions,
    reasonLabel,
    optionEffect,
    optionRecipeEffects,
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
        `  FAIL ${label}\n       beklenen: ${JSON.stringify(expected)}\n       gelen:    ${JSON.stringify(actual)}`,
      )
    }
  }

  // Latte: net 85 · %20 KDV → brüt 102
  const line = (patch = {}) => ({ quantity: 1, unitPrice: 85, vatRate: 20, ...patch })

  console.log("\n== Kalem durumları ==")
  eq("durumsuz kalem NORMAL sayılır", isBillableItem(undefined), true)
  eq("ikram hesaba girmez", isBillableItem("COMP"), false)
  eq("ikram stok düşürür", consumesStock("COMP"), true)
  eq("zayi stok düşürür", consumesStock("WASTE"), true)
  eq("iptal stok düşürmez", consumesStock("VOID"), false)
  eq("sebep etiketi", reasonLabel("COMP", "COMPLAINT"), "Müşteri şikâyeti")
  eq("bilinmeyen sebep null", reasonLabel("COMP", "YOK"), null)

  console.log("\n== Toplam ==")
  eq("iki kalem", ticketTotals([line(), line({ quantity: 2 })]), {
    net: 255,
    vat: 51,
    gross: 306,
    discount: 0,
    netDiscount: 0,
    total: 306,
  })

  // İkram/zayi/iptal HESABA girmez: ödenecek tutar tek kalemin tutarıdır.
  eq(
    "ikram/zayi/iptal hesaba girmez",
    ticketTotals([
      line(),
      line({ status: "COMP" }),
      line({ status: "WASTE" }),
      line({ status: "VOID" }),
    ]).total,
    102,
  )

  console.log("\n== İskonto ==")
  const pct = ticketTotals([line({ quantity: 2 })], { type: "PERCENT", value: 10 })
  eq("yüzde iskonto brütten düşer", pct.total, 183.6)
  // Matrah karşılığı: 170 * %10 = 17. Fatura ucu matrahtan düşüp KDV'yi aynı
  // oranda azalttığı için ödenecek tutar birebir tutmak zorunda.
  eq("matrah karşılığı", pct.netDiscount, 17)
  eq("net + KDV - iskonto = toplam", Math.round((pct.gross - pct.discount) * 100) / 100, pct.total)

  const amount = ticketTotals([line({ quantity: 2 })], { type: "AMOUNT", value: 50 })
  eq("tutar iskontosu KDV DAHİL girilir", amount.total, 154)
  eq("tutarın matrah karşılığı", amount.netDiscount, 41.67)

  eq(
    "iskonto hesabı aşamaz",
    ticketTotals([line()], { type: "AMOUNT", value: 500 }).total,
    0,
  )
  eq(
    "yüzde 100'ü aşamaz",
    ticketTotals([line()], { type: "PERCENT", value: 150 }).total,
    0,
  )
  eq(
    "boş hesapta iskonto sıfır",
    ticketTotals([], { type: "PERCENT", value: 10 }),
    { net: 0, vat: 0, gross: 0, discount: 0, netDiscount: 0, total: 0 },
  )
  eq(
    "tüm kalemler ikramsa toplam sıfır",
    ticketTotals([line({ status: "COMP" })], { type: "PERCENT", value: 10 }).total,
    0,
  )

  console.log("\n== İskonto okuma ==")
  eq("geçerli iskonto", ticketDiscountOf({ discountType: "PERCENT", discountValue: 10 }), {
    type: "PERCENT",
    value: 10,
  })
  eq("sıfır değer iskonto sayılmaz", ticketDiscountOf({ discountType: "PERCENT", discountValue: 0 }), null)
  eq("bozuk tür iskonto sayılmaz", ticketDiscountOf({ discountType: "XX", discountValue: 5 }), null)
  eq("tanımsız", ticketDiscountOf({}), null)

  console.log("\n== Seçenekler ==")
  eq(
    "seçenekler okunur",
    parseItemOptions([{ groupName: "Boy", optionName: "Büyük", priceDelta: 15 }]),
    [{ groupName: "Boy", optionName: "Büyük", priceDelta: 15, effect: null, recipeFactor: null }],
  )
  eq("adsız şık atılır", parseItemOptions([{ groupName: "Boy" }]), [])
  eq("dizi değilse boş", parseItemOptions("bozuk"), [])
  eq("null güvenli", parseItemOptions(null), [])

  // Reçete etkisi kaleme KOPYALANIR (SATIS-EKRANI.md K6): menü sonradan
  // değişse de açık adisyonun stok karşılığı sabit kalmalı.
  console.log("\n== Seçeneğin reçete etkisi ==")
  const swap = { mode: "SWAP", fromProductId: "sut", toProductId: "soya" }
  eq(
    "kaydedilmiş etki geri okunur",
    parseItemOptions([{ groupName: "Süt", optionName: "Soya", priceDelta: 15, effect: swap, recipeFactor: 1.5 }])[0],
    { groupName: "Süt", optionName: "Soya", priceDelta: 15, effect: swap, recipeFactor: 1.5 },
  )
  eq(
    "bozuk etki etkisiz sayılır",
    parseItemOptions([{ optionName: "X", effect: { mode: "NUKE" } }])[0].effect,
    null,
  )
  eq("etkisiz seçenekler", optionRecipeEffects([{ optionName: "Küçük", priceDelta: 0 }]), {
    effects: [],
    recipeFactor: 1,
  })
  eq(
    "etkiler toplanır, çarpanlar ÇARPILIR",
    optionRecipeEffects([
      { optionName: "Soya", effect: swap },
      { optionName: "Büyük", recipeFactor: 1.5 },
      { optionName: "Duble", recipeFactor: 2 },
    ]),
    { effects: [swap], recipeFactor: 3 },
  )
  eq("bozuk çarpan yok sayılır", optionRecipeEffects([{ optionName: "X", recipeFactor: 0 }]).recipeFactor, 1)
  eq("seçenek yoksa nötr", optionRecipeEffects(null), { effects: [], recipeFactor: 1 })

  console.log("\n== optionEffect (tanım -> etki) ==")
  eq("SWAP", optionEffect({ effectMode: "SWAP", fromProductId: "sut", toProductId: "soya" }), swap)
  eq("hedefsiz SWAP = çıkar", optionEffect({ effectMode: "SWAP", fromProductId: "seker" }), {
    mode: "SWAP",
    fromProductId: "seker",
    toProductId: null,
  })
  eq("kaynaksız SWAP geçersiz", optionEffect({ effectMode: "SWAP", toProductId: "soya" }), null)
  eq(
    "ADD",
    optionEffect({ effectMode: "ADD", toProductId: "espresso", effectQuantity: 1, effectUnit: "ADET" }),
    { mode: "ADD", productId: "espresso", quantity: 1, unit: "ADET" },
  )
  eq("miktarsız ADD geçersiz", optionEffect({ effectMode: "ADD", toProductId: "espresso" }), null)
  eq("mod yoksa etki yok", optionEffect({ recipeFactor: 1.5 }), null)

  console.log(`\n${fail === 0 ? "TÜMÜ GEÇTİ" : "BAŞARISIZ"} — ${pass} geçti, ${fail} kaldı\n`)
  process.exit(fail === 0 ? 0 : 1)
} finally {
  rmSync(out, { recursive: true, force: true })
}
