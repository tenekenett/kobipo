/**
 * Reçete genişletme motorunun birim testleri (Restoran & Kafe modülü).
 *
 * Çalıştırma:  node scripts/test-recipe-expand.mjs
 *
 * Projede test koşucusu yok; bu script test edilecek iki SAF modülü geçici bir
 * klasöre derleyip (tsc) doğrudan çalıştırır. Yalnızca lib/data/units.ts ve
 * lib/stock/recipe-expand.ts'e dokunur — DB, ağ veya Next.js gerekmez.
 *
 * Doğrulanan senaryolar docs/restoran/PLAN.md "Doğrulama senaryoları" ile aynıdır.
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const out = mkdtempSync(join(tmpdir(), "kobipo-recipe-"))

try {
  // tsc'yi npx yerine doğrudan çağırıyoruz: Node 18.20+ güvenlik nedeniyle
  // .cmd/.bat dosyalarını shell olmadan spawn etmiyor (npx.cmd burada patlardı).
  const tsc = join(process.cwd(), "node_modules", "typescript", "bin", "tsc")
  if (!existsSync(tsc)) {
    console.error("typescript bulunamadı — önce `npm install` çalıştırın.")
    process.exit(1)
  }

  // tsc, "@/lib/data/units" alias'ını çözemediği için hata koduyla döner ama JS'i
  // yine de üretir. Bu yüzden çıkış kodunu yutup emit edilen dosyaya bakıyoruz.
  let tscOutput = ""
  try {
    execFileSync(
      process.execPath,
      [
        tsc,
        "lib/data/units.ts",
        "lib/stock/recipe-expand.ts",
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

  const expandPath = join(out, "stock", "recipe-expand.js")
  if (!existsSync(expandPath)) {
    console.error("tsc çıktı üretemedi:\n" + tscOutput)
    process.exit(1)
  }

  writeFileSync(
    expandPath,
    readFileSync(expandPath, "utf8").replace(/["']@\/lib\/data\/units["']/, '"../data/units.js"')
  )
  writeFileSync(join(out, "package.json"), '{"type":"module"}')

  const { expandRecipeLines, findRecipePath, buildRecipeMap, parseRecipeEffects, hasActiveRecipe } =
    await import(pathToFileURL(expandPath).href)
  const { convertUnit, canConvert, convertibleUnits, defaultRecipeUnit } = await import(
    pathToFileURL(join(out, "data", "units.js")).href
  )

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

  console.log("\n== Birim dönüşümü ==")
  eq("20 GR -> KG", convertUnit(20, "GR", "KG"), 0.02)
  eq("200 ML -> LT", convertUnit(200, "ML", "LT"), 0.2)
  eq("5 ML -> LT", convertUnit(5, "ML", "LT"), 0.005)
  eq("1 ADET -> ADET", convertUnit(1, "ADET", "ADET"), 1)
  eq("ADET -> GR (tanımsız)", convertUnit(1, "ADET", "GR"), null)
  eq("canConvert kg/gram (serbest yazım)", canConvert("kilogram", "gram"), true)
  eq("convertibleUnits(LT)", convertibleUnits("LT").sort(), ["LT", "ML"])

  // defaultRecipeUnit: reçetede kullanılacak VARSAYILAN birim ailenin küçüğüdür.
  // Stok birimini varsayılan yapmak, "200" yazan kullanıcıya 200 ml yerine
  // 200 LİTRE yazdırıyordu (gerçek testte stok 19,4 -> -180,6 LT oldu).
  eq("defaultRecipeUnit(LT) -> ML", defaultRecipeUnit("LT"), "ML")
  eq("defaultRecipeUnit(ML) -> ML", defaultRecipeUnit("ML"), "ML")
  eq("defaultRecipeUnit(KG) -> GR", defaultRecipeUnit("KG"), "GR")
  eq("defaultRecipeUnit(TON) -> GR", defaultRecipeUnit("TON"), "GR")
  eq("defaultRecipeUnit(MT) -> CM", defaultRecipeUnit("MT"), "CM")
  eq("defaultRecipeUnit(ADET) -> ADET (aile yok)", defaultRecipeUnit("ADET"), "ADET")
  eq("defaultRecipeUnit(bos) -> bos", defaultRecipeUnit(null), "")
  eq("varsayilan birim daima donusturulebilir", canConvert(defaultRecipeUnit("LT"), "LT"), true)

  // PLAN.md kurulumu: Latte = 1 Espresso + 200 ML süt + 5 ML vanilya
  //                   Espresso = 20 GR kahve   (yarı mamül, sanal)
  const KAHVE = "kahve"
  const SUT = "sut"
  const VANILYA = "vanilya"
  const ESPRESSO = "espresso"
  const LATTE = "latte"
  const units = { [KAHVE]: "KG", [SUT]: "LT", [VANILYA]: "LT", [ESPRESSO]: "ADET", [LATTE]: "ADET" }
  const unitOf = (id) => units[id] ?? null

  const recipes = new Map([
    [ESPRESSO, { yieldQuantity: 1, isActive: true, items: [{ componentProductId: KAHVE, quantity: 20, unit: "GR" }] }],
    [LATTE, { yieldQuantity: 1, isActive: true, items: [
      { componentProductId: ESPRESSO, quantity: 1, unit: "ADET" },
      { componentProductId: SUT, quantity: 200, unit: "ML" },
      { componentProductId: VANILYA, quantity: 5, unit: "ML" },
    ] }],
  ])

  console.log("\n== Senaryo 1: 3 Latte (özyinelemeli düşüm) ==")
  const r3 = expandRecipeLines({ lines: [{ productId: LATTE, quantity: 3 }], recipes, unitOf })
  eq("hata yok", r3.errors, [])
  const d3 = Object.fromEntries(r3.components.map((d) => [d.productId, d.quantity]))
  eq("kahve (0,06 KG)", d3[KAHVE], 0.06)
  eq("süt (0,6 LT)", d3[SUT], 0.6)
  eq("vanilya (0,015 LT)", d3[VANILYA], 0.015)
  eq("espresso düşmez (sanal)", d3[ESPRESSO], undefined)
  eq("latte düşmez (reçeteli)", d3[LATTE], undefined)

  console.log("\n== Senaryo 2: 1 Latte hassasiyet ==")
  const r1 = expandRecipeLines({ lines: [{ productId: LATTE, quantity: 1 }], recipes, unitOf })
  const d1 = Object.fromEntries(r1.components.map((d) => [d.productId, d.quantity]))
  eq("vanilya tam 0,005 (Decimal(10,2)'de kaybolurdu)", d1[VANILYA], 0.005)
  eq("kahve tam 0,02", d1[KAHVE], 0.02)

  console.log("\n== Aynı hammadde birden fazla daldan toplanır ==")
  recipes.set("americano", { yieldQuantity: 1, isActive: true, items: [{ componentProductId: ESPRESSO, quantity: 2, unit: "ADET" }] })
  const rMix = expandRecipeLines({
    lines: [{ productId: LATTE, quantity: 1 }, { productId: "americano", quantity: 1 }],
    recipes,
    unitOf,
  })
  eq("kahve = 1x20gr + 2x20gr = 0,06 KG", rMix.components.find((d) => d.productId === KAHVE)?.quantity, 0.06)
  eq("tek kahve satırı", rMix.components.filter((d) => d.productId === KAHVE).length, 1)

  console.log("\n== Fire (wastage) ==")
  const rW = expandRecipeLines({
    lines: [{ productId: "x", quantity: 1 }],
    recipes: new Map([["x", { yieldQuantity: 1, isActive: true, items: [{ componentProductId: SUT, quantity: 100, unit: "ML", wastageRate: 10 }] }]]),
    unitOf,
  })
  eq("100 ML + %10 fire = 0,11 LT", rW.components[0].quantity, 0.11)

  console.log("\n== yieldQuantity (10 porsiyonluk reçete) ==")
  const rY = expandRecipeLines({
    lines: [{ productId: "sos", quantity: 3 }],
    recipes: new Map([["sos", { yieldQuantity: 10, isActive: true, items: [{ componentProductId: SUT, quantity: 1000, unit: "ML" }] }]]),
    unitOf,
  })
  eq("3 porsiyon = 3/10 x 1000ML = 0,3 LT", rY.components[0].quantity, 0.3)

  console.log("\n== Pasif reçete hammadde gibi düşer ==")
  const rP = expandRecipeLines({
    lines: [{ productId: LATTE, quantity: 1 }],
    recipes: new Map([[LATTE, { yieldQuantity: 1, isActive: false, items: [{ componentProductId: SUT, quantity: 200, unit: "ML" }] }]]),
    unitOf,
  })
  eq("pasif reçeteli ürün kendisi düşer (direct)", rP.direct, [{ productId: LATTE, quantity: 1 }])
  eq("bileşen üretilmedi", rP.components, [])

  console.log("\n== direct / components ayrımı ==")
  // Şişe su (reçetesiz) + Latte (reçeteli) aynı fişte: biri direct, diğeri components.
  const rSplit = expandRecipeLines({
    lines: [{ productId: "sisesu", quantity: 2 }, { productId: LATTE, quantity: 1 }],
    recipes,
    unitOf,
  })
  eq("reçetesiz ürün direct'e gider", rSplit.direct, [{ productId: "sisesu", quantity: 2 }])
  eq("reçeteli ürün direct'e GİRMEZ", rSplit.direct.some((d) => d.productId === LATTE), false)
  eq("bileşenler components'ta", rSplit.components.map((c) => c.productId).sort(), [KAHVE, SUT, VANILYA].sort())
  eq(
    "kahve kaynağı = latte (espresso üzerinden gelse de)",
    rSplit.components.find((c) => c.productId === KAHVE)?.sources,
    [LATTE]
  )

  console.log("\n== İki mamülden gelen bileşenin kaynakları ==")
  const rSrc = expandRecipeLines({
    lines: [{ productId: LATTE, quantity: 1 }, { productId: "americano", quantity: 1 }],
    recipes,
    unitOf,
  })
  eq(
    "kahve iki kaynağa atfedilir",
    rSrc.components.find((c) => c.productId === KAHVE)?.sources.sort(),
    ["americano", LATTE].sort()
  )

  console.log("\n== Senaryo 4: Döngü koruması ==")
  const cyc = new Map([
    [LATTE, { yieldQuantity: 1, isActive: true, items: [{ componentProductId: ESPRESSO, quantity: 1, unit: "ADET" }] }],
    [ESPRESSO, { yieldQuantity: 1, isActive: true, items: [{ componentProductId: LATTE, quantity: 1, unit: "ADET" }] }],
  ])
  const rC = expandRecipeLines({ lines: [{ productId: LATTE, quantity: 1 }], recipes: cyc, unitOf })
  eq("CYCLE hatası üretildi", rC.errors.map((e) => e.reason), ["CYCLE"])
  eq("sonsuz döngüye girmedi", rC.components, [])
  eq("findRecipePath: espresso -> latte", findRecipePath(ESPRESSO, LATTE, cyc), [ESPRESSO, LATTE])
  eq("findRecipePath: kendine referans", findRecipePath(LATTE, LATTE, recipes), [LATTE])
  eq("findRecipePath: yol yok", findRecipePath(KAHVE, LATTE, recipes), null)

  console.log("\n== Birim uyuşmazlığı ==")
  const rU = expandRecipeLines({
    lines: [{ productId: "x", quantity: 1 }],
    recipes: new Map([["x", { yieldQuantity: 1, isActive: true, items: [{ componentProductId: KAHVE, quantity: 1, unit: "ADET" }] }]]),
    unitOf,
  })
  eq("UNIT_MISMATCH (ADET -> KG)", rU.errors.map((e) => e.reason), ["UNIT_MISMATCH"])
  eq("hatalı dal düşülmedi", rU.components, [])

  console.log("\n== buildRecipeMap (API kaydı -> genişletme haritası) ==")
  // Reçete ekranı ve satış ekranı haritayı buradan kuruyor; sunucudaki
  // loadRecipeContext ile aynı kuralı uygulamak zorunda: yalnız AKTİF reçeteler.
  const built = buildRecipeMap([
    { productId: LATTE, yieldQuantity: 1, isActive: true, items: [{ componentProductId: SUT, quantity: 200, unit: "ML", wastageRate: null }] },
    { productId: "pasif", yieldQuantity: 1, isActive: false, items: [{ componentProductId: SUT, quantity: 50, unit: "ML" }] },
    { productId: "sifiryield", yieldQuantity: 0, isActive: true, items: [{ componentProductId: SUT, quantity: 100, unit: "ML" }] },
  ])
  eq("pasif reçete haritaya girmez", built.has("pasif"), false)
  eq("aktif reçete haritada", built.has(LATTE), true)
  eq("yieldQuantity 0 -> 1", built.get("sifiryield").yieldQuantity, 1)
  const rBuilt = expandRecipeLines({ lines: [{ productId: LATTE, quantity: 2 }], recipes: built, unitOf })
  eq("harita genişletmede çalışıyor (2 x 200ML = 0,4 LT)", rBuilt.components[0].quantity, 0.4)

  // ---- Seçeneğin reçeteye etkisi (docs/restoran/SATIS-EKRANI.md K6) ---------
  // Buradaki her kontrol bir PARA sorusudur: soya sütlü latte satılınca inek
  // sütü düşerse hem soya sütü stokta şişer hem maliyet yalan söyler.

  const SOYA = "soya"
  const DEKAF = "dekaf"
  const SISESU = "sisesu"
  units[SOYA] = "LT"
  units[DEKAF] = "KG"
  units[SISESU] = "ADET"

  const swapSut = { mode: "SWAP", fromProductId: SUT, toProductId: SOYA }
  const qtyOf = (result, id) => result.components.find((c) => c.productId === id)?.quantity

  console.log("\n== Etki: DEĞİŞİM (soya sütü) ==")
  const rSwap = expandRecipeLines({
    lines: [{ productId: LATTE, quantity: 1, effects: [swapSut] }],
    recipes,
    unitOf,
  })
  eq("hata yok", rSwap.errors, [])
  eq("soya sütü düştü (0,2 LT)", qtyOf(rSwap, SOYA), 0.2)
  eq("inek sütü HİÇ düşmedi", qtyOf(rSwap, SUT), undefined)
  eq("diğer bileşenler dokunulmadı (kahve 0,02 KG)", qtyOf(rSwap, KAHVE), 0.02)
  eq("değişen bileşen de mamüle atfedilir", rSwap.components.find((c) => c.productId === SOYA)?.sources, [LATTE])

  console.log("\n== Etki: DEĞİŞİM hedefsiz (çıkar / 'şekersiz') ==")
  const rRemove = expandRecipeLines({
    lines: [
      { productId: LATTE, quantity: 1, effects: [{ mode: "SWAP", fromProductId: VANILYA, toProductId: null }] },
    ],
    recipes,
    unitOf,
  })
  eq("vanilya düşmedi", qtyOf(rRemove, VANILYA), undefined)
  eq("hata üretilmedi (bilinçli çıkarma)", rRemove.errors, [])
  eq("süt normal düştü", qtyOf(rRemove, SUT), 0.2)

  console.log("\n== Etki: DEĞİŞİM alt reçetede (kahve -> dekaf) ==")
  // Kahve, Latte'nin doğrudan bileşeni DEĞİL — Espresso'nun içinden geliyor.
  // "Dekaf latte" istendiğinde değişimin oraya kadar inmesi gerekir.
  const rDeep = expandRecipeLines({
    lines: [
      { productId: LATTE, quantity: 1, effects: [{ mode: "SWAP", fromProductId: KAHVE, toProductId: DEKAF }] },
    ],
    recipes,
    unitOf,
  })
  eq("dekaf düştü (0,02 KG)", qtyOf(rDeep, DEKAF), 0.02)
  eq("normal kahve düşmedi", qtyOf(rDeep, KAHVE), undefined)

  console.log("\n== Etki: EKLEME (ekstra shot) ==")
  const extraShot = { mode: "ADD", productId: ESPRESSO, quantity: 1, unit: "ADET" }
  const rAdd = expandRecipeLines({
    lines: [{ productId: LATTE, quantity: 1, effects: [extraShot] }],
    recipes,
    unitOf,
  })
  eq("eklenen yarı mamül de açıldı: kahve 0,02 + 0,02 = 0,04 KG", qtyOf(rAdd, KAHVE), 0.04)
  eq("espresso'nun kendisi düşmez (sanal)", qtyOf(rAdd, ESPRESSO), undefined)
  eq("ek malzeme satılan mamüle atfedilir", rAdd.components.find((c) => c.productId === KAHVE)?.sources, [LATTE])

  console.log("\n== Etki: EKLEME satır adediyle çarpılır ==")
  const rAdd2 = expandRecipeLines({
    lines: [{ productId: LATTE, quantity: 2, effects: [extraShot] }],
    recipes,
    unitOf,
  })
  eq("2 latte + 2 shot = 0,08 KG kahve", qtyOf(rAdd2, KAHVE), 0.08)

  console.log("\n== Etki: EKLEME reçetesiz ürüne ==")
  const rAddPlain = expandRecipeLines({
    lines: [
      { productId: SISESU, quantity: 2, effects: [{ mode: "ADD", productId: SUT, quantity: 50, unit: "ML" }] },
    ],
    recipes,
    unitOf,
  })
  eq("ürünün kendisi direct'te kalır", rAddPlain.direct, [{ productId: SISESU, quantity: 2 }])
  eq("ek malzeme components'ta (2 x 50ML = 0,1 LT)", qtyOf(rAddPlain, SUT), 0.1)

  console.log("\n== Etki: PORSİYON ÇARPANI ==")
  const rBig = expandRecipeLines({
    lines: [{ productId: LATTE, quantity: 1, recipeFactor: 1.5 }],
    recipes,
    unitOf,
  })
  eq("süt 1,5 kat (0,3 LT)", qtyOf(rBig, SUT), 0.3)
  eq("alt reçete de ölçeklendi: kahve 0,03 KG", qtyOf(rBig, KAHVE), 0.03)

  console.log("\n== Etki: çarpan reçetesiz üründe YOK SAYILIR ==")
  const rBigPlain = expandRecipeLines({
    lines: [{ productId: SISESU, quantity: 2, recipeFactor: 1.5 }],
    recipes,
    unitOf,
  })
  eq("1,5 şişe su diye bir şey yok — 2 kalır", rBigPlain.direct, [{ productId: SISESU, quantity: 2 }])

  console.log("\n== Etki: çarpan ek malzemeyi ölçeklemez ==")
  const rBigAdd = expandRecipeLines({
    lines: [{ productId: LATTE, quantity: 1, recipeFactor: 2, effects: [extraShot] }],
    recipes,
    unitOf,
  })
  // Reçete 2 kat (0,04) + ekstra shot TEK (0,02) = 0,06. Ekstra shot da
  // ölçeklenseydi 0,08 çıkardı — büyük boy sipariş çift shot yazardı.
  eq("2x reçete + 1 shot = 0,06 KG kahve", qtyOf(rBigAdd, KAHVE), 0.06)

  console.log("\n== Etki: bozuk çarpan 1 sayılır ==")
  const rBadFactor = expandRecipeLines({
    lines: [{ productId: LATTE, quantity: 1, recipeFactor: 0 }],
    recipes,
    unitOf,
  })
  eq("çarpan 0 -> 1 (süt 0,2 LT)", qtyOf(rBadFactor, SUT), 0.2)

  console.log("\n== Etki: expandBase=false (yalnız etkiler) ==")
  const rNoBase = expandRecipeLines({
    lines: [
      { productId: SISESU, quantity: 2, expandBase: false, effects: [{ mode: "ADD", productId: SUT, quantity: 50, unit: "ML" }] },
    ],
    recipes,
    unitOf,
  })
  eq("ürünün kendisi genişletilmedi", rNoBase.direct, [])
  eq("ek malzeme yine düştü", qtyOf(rNoBase, SUT), 0.1)

  console.log("\n== Etki: satıra ÖZELDİR (aynı ürünün iki satırı) ==")
  const rTwoLines = expandRecipeLines({
    lines: [
      { productId: LATTE, quantity: 1, effects: [swapSut] },
      { productId: LATTE, quantity: 1 },
    ],
    recipes,
    unitOf,
  })
  eq("soya sütlü satır: 0,2 LT soya", qtyOf(rTwoLines, SOYA), 0.2)
  eq("normal satır: 0,2 LT süt", qtyOf(rTwoLines, SUT), 0.2)
  eq("kahve iki satırdan toplandı (0,04 KG)", qtyOf(rTwoLines, KAHVE), 0.04)

  console.log("\n== Etki: birim çevrilemezse SESSİZ KALMAZ ==")
  const rSwapBad = expandRecipeLines({
    // Süt (ML cinsinden reçetede) kahveyle (KG stok) değiştirilirse dönüşüm yok.
    lines: [{ productId: LATTE, quantity: 1, effects: [{ mode: "SWAP", fromProductId: SUT, toProductId: KAHVE }] }],
    recipes,
    unitOf,
  })
  eq("UNIT_MISMATCH üretildi", rSwapBad.errors.map((e) => e.reason), ["UNIT_MISMATCH"])
  eq("hatalı dal düşülmedi", rSwapBad.components.some((c) => c.productId === KAHVE && c.quantity === 0.2), false)

  const rSwapGone = expandRecipeLines({
    // Hedef ürün silinmiş: unitOf null döner, uydurma miktar düşülmemeli.
    lines: [{ productId: LATTE, quantity: 1, effects: [{ mode: "SWAP", fromProductId: SUT, toProductId: "silinmis" }] }],
    recipes,
    unitOf,
  })
  eq("silinmiş hedef -> UNIT_MISMATCH", rSwapGone.errors.map((e) => e.reason), ["UNIT_MISMATCH"])
  eq("süt de düşmedi (değişim uygulandı)", qtyOf(rSwapGone, SUT), undefined)

  console.log("\n== parseRecipeEffects (dış dünyadan gelen girdi) ==")
  eq("dizi değilse boş", parseRecipeEffects("x"), [])
  eq("tanınmayan mod elenir", parseRecipeEffects([{ mode: "NUKE", productId: SUT }]), [])
  eq("kaynaksız SWAP elenir", parseRecipeEffects([{ mode: "SWAP", toProductId: SOYA }]), [])
  eq("negatif miktarlı ADD elenir", parseRecipeEffects([{ mode: "ADD", productId: SUT, quantity: -1, unit: "ML" }]), [])
  eq(
    "geçerli olanlar korunur",
    parseRecipeEffects([{ mode: "SWAP", fromProductId: SUT, toProductId: SOYA }, null, { mode: "ADD", productId: ESPRESSO, quantity: 1, unit: "ADET" }]),
    [swapSut, extraShot]
  )
  eq("hedefsiz SWAP geçerli (çıkar)", parseRecipeEffects([{ mode: "SWAP", fromProductId: SUT }]), [
    { mode: "SWAP", fromProductId: SUT, toProductId: null },
  ])

  console.log("\n== hasActiveRecipe ==")
  eq("reçeteli ürün", hasActiveRecipe(recipes, LATTE), true)
  eq("reçetesiz ürün", hasActiveRecipe(recipes, SISESU), false)
  eq("pasif reçete", hasActiveRecipe(new Map([[LATTE, { yieldQuantity: 1, isActive: false, items: [{ componentProductId: SUT, quantity: 1, unit: "LT" }] }]]), LATTE), false)

  console.log(`\n${fail === 0 ? "TÜMÜ GEÇTİ" : "BAŞARISIZ"} — ${pass} geçti, ${fail} kaldı\n`)
  process.exit(fail === 0 ? 0 : 1)
} finally {
  rmSync(out, { recursive: true, force: true })
}
