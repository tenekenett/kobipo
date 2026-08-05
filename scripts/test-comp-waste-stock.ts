/**
 * İkram (COMP) ve zayi (WASTE) kalemlerinin STOK etkisinin entegrasyon testi.
 *
 * Çalıştırma:  npx tsx scripts/test-comp-waste-stock.ts
 *
 * Next.js gerekmez — doğrudan Prisma ve `writeCompWasteStock` çağrılır. Test
 * verisi Demo Firma A.Ş.'de OLUŞTURULUR ve sonunda TEMİZLENİR (hareketler
 * silinir, ürün stoğu başlangıç değerine döndürülür).
 *
 * Neden bu test: ikram/zayi eskiden kalem silinerek yapılıyordu ve malzeme
 * stoktan HİÇ düşmüyordu. Düzeltmenin gerçekten stoğa yazdığını, iptalin (VOID)
 * ise yazmadığını doğrulamak parayla ilgili tek kanıt.
 */
import { prisma } from "@/lib/db/prisma"
import { writeCompWasteStock } from "@/lib/restoran/comp-waste-stock"
import { ticketTotals } from "@/lib/restoran/ticket-constants"

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) {
    pass++
    console.log(`  OK   ${label}${detail ? ` → ${detail}` : ""}`)
  } else {
    fail++
    console.log(`  FAIL ${label}${detail ? ` → ${detail}` : ""}`)
  }
}

const num = (v: unknown) => Number(v ?? 0)

async function main() {
  const company = await prisma.company.findFirst({
    where: { name: { contains: "Demo Firma" } },
    select: { id: true, name: true },
  })
  if (!company) throw new Error("Demo Firma bulunamadı")
  console.log(`Firma: ${company.name}\n`)

  // Reçeteli bir menü ürünü ve bileşeni gerek: ikram edilen mamülün BİLEŞENİ
  // düşmeli (mamülün kendisi değil).
  const recipe = await prisma.productRecipe.findFirst({
    where: { companyId: company.id, isActive: true, items: { some: {} } },
    include: { product: true, items: { include: { component: true } } },
  })
  if (!recipe) throw new Error("Demo Firma'da aktif reçete yok")

  const mamul = recipe.product
  const component = recipe.items[0].component
  const before = num(
    (await prisma.product.findUnique({ where: { id: component.id } }))?.stockQuantity,
  )
  console.log(`Mamül: ${mamul.name} · Bileşen: ${component.name} (stok ${before})\n`)

  const reference = `TEST-COMP-${Date.now()}`
  const lines = [
    { productId: mamul.id, quantity: 1, status: "NORMAL", reasonCode: null, description: mamul.name },
    { productId: mamul.id, quantity: 2, status: "COMP", reasonCode: "COMPLAINT", description: mamul.name },
    { productId: mamul.id, quantity: 1, status: "WASTE", reasonCode: "SPILLED", description: mamul.name },
    { productId: mamul.id, quantity: 5, status: "VOID", reasonCode: "MISENTRY", description: mamul.name },
  ]

  console.log("== Toplam ==")
  const totals = ticketTotals(
    lines.map((l) => ({ quantity: l.quantity, unitPrice: 100, vatRate: 20, status: l.status })),
  )
  check("yalnız NORMAL kalem hesaba girer", totals.total === 120, `${totals.total}`)

  console.log("\n== Stok düzeltmesi ==")
  await writeCompWasteStock({
    companyId: company.id,
    lines,
    ticketCode: "ADS-TEST",
    reference,
  })

  const movements = await prisma.stockMovement.findMany({
    where: { companyId: company.id, reference },
    select: { productId: true, quantity: true, type: true, description: true, unitPrice: true },
  })

  // İkram ve zayi AYRI hareket yazar (denetim raporu ikisini ayırabilsin diye),
  // bu yüzden aynı bileşen için iki satır oluşur ve toplamları karşılaştırılır.
  const componentMoves = movements.filter((m) => m.productId === component.id)
  const componentQty = componentMoves.reduce((s, m) => s + num(m.quantity), 0)
  const componentMove = componentMoves[0]
  check("bileşen için hareket yazıldı", componentMoves.length > 0)
  check(
    "ikram ve zayi AYRI hareket",
    componentMoves.length === 2 &&
      componentMoves.some((m) => m.description?.includes("İkram")) &&
      componentMoves.some((m) => m.description?.includes("Zayi")),
    componentMoves.map((m) => m.description).join(" | "),
  )

  // Beklenen miktarı ELLE hesaplamıyoruz: reçete birim çevrimi yapıyor (20 g
  // çekirdek → 0,02 KG stok). Bunun yerine TEK birimlik bir referans düşüm
  // yazıp oranı kontrol ediyoruz — "yalnız ikram+zayi sayıldı" iddiası birim
  // matematiğinden bağımsız kanıtlanır. Çevrimin kendisi ayrıca test ediliyor
  // (scripts/test-recipe-expand.mjs, 45 kontrol).
  const unitRef = `TEST-UNIT-${Date.now()}`
  await writeCompWasteStock({
    companyId: company.id,
    lines: [
      { productId: mamul.id, quantity: 1, status: "COMP", reasonCode: "PROMO", description: mamul.name },
    ],
    ticketCode: "ADS-TEST-REF",
    reference: unitRef,
  })
  const unitMove = await prisma.stockMovement.findFirst({
    where: { companyId: company.id, reference: unitRef, productId: component.id },
    select: { quantity: true },
  })
  const expected = num(unitMove?.quantity) * 3
  check(
    "yalnız ikram+zayi kadar düştü (normal ve iptal hariç)",
    componentMoves.length > 0 && Math.abs(componentQty - expected) < 0.0001,
    `${componentMoves.length > 0 ? componentQty : "yok"} = 3 × ${num(unitMove?.quantity)}`,
  )
  check("düşüm negatif (stoktan çıkış)", componentMoves.every((m) => num(m.quantity) < 0))
  check(
    "hareket tipi ADJUSTMENT (satış değil)",
    movements.every((m) => m.type === "ADJUSTMENT"),
    movements.map((m) => m.type).join(","),
  )
  check(
    "açıklama sebebi taşıyor",
    !!componentMove?.description?.includes("ADS-TEST"),
    componentMove?.description ?? "",
  )
  check(
    "mamülün KENDİSİ düşmedi (reçete açıldı)",
    !movements.some((m) => m.productId === mamul.id),
  )

  const after = num(
    (await prisma.product.findUnique({ where: { id: component.id } }))?.stockQuantity,
  )
  // Referans düşümü de bakiyeye girdi: 3 birim + 1 referans birim.
  const expectedAfter = before + expected + expected / 3
  check("ürün bakiyesi güncellendi", Math.abs(after - expectedAfter) < 0.0001, `${before} → ${after}`)

  // Seçeneğin reçete etkisi ikram/zayi yolunda da geçerli olmalı: soya sütlü
  // bir latte ikram edildiğinde inek sütü düşerse ikram maliyeti de yanlış olur
  // (docs/restoran/SATIS-EKRANI.md K6). Etkinin fiilen uygulandığını iki uçtan
  // kanıtlıyoruz: "çıkar" hiç düşmemeli, çarpan tam katına düşmeli.
  console.log("\n== Seçenek reçete etkisi ==")
  const removeRef = `TEST-SWAP-${Date.now()}`
  await writeCompWasteStock({
    companyId: company.id,
    lines: [
      {
        productId: mamul.id,
        quantity: 1,
        status: "COMP",
        reasonCode: "PROMO",
        description: mamul.name,
        // "Şekersiz" deseni: bileşen reçeteden çıkarıldı.
        effects: [{ mode: "SWAP", fromProductId: component.id, toProductId: null }],
      },
    ],
    ticketCode: "ADS-TEST-SWAP",
    reference: removeRef,
  })
  const removedMove = await prisma.stockMovement.count({
    where: { companyId: company.id, reference: removeRef, productId: component.id },
  })
  check("değişimle ÇIKARILAN bileşen ikramda da düşmedi", removedMove === 0, `${removedMove} hareket`)

  const factorRef = `TEST-FACTOR-${Date.now()}`
  await writeCompWasteStock({
    companyId: company.id,
    lines: [
      {
        productId: mamul.id,
        quantity: 1,
        status: "COMP",
        reasonCode: "PROMO",
        description: mamul.name,
        recipeFactor: 2,
      },
    ],
    ticketCode: "ADS-TEST-FACTOR",
    reference: factorRef,
  })
  const factorMove = await prisma.stockMovement.findFirst({
    where: { companyId: company.id, reference: factorRef, productId: component.id },
    select: { quantity: true },
  })
  check(
    "porsiyon çarpanı malzemeyi ölçekledi (2 kat)",
    Math.abs(num(factorMove?.quantity) - num(unitMove?.quantity) * 2) < 0.0001,
    `${num(factorMove?.quantity)} = 2 × ${num(unitMove?.quantity)}`,
  )

  console.log("\n== VOID tek başına hiçbir şey yazmaz ==")
  const voidRef = `TEST-VOID-${Date.now()}`
  await writeCompWasteStock({
    companyId: company.id,
    lines: [
      { productId: mamul.id, quantity: 3, status: "VOID", reasonCode: "MISENTRY", description: mamul.name },
    ],
    ticketCode: "ADS-TEST-2",
    reference: voidRef,
  })
  const voidMoves = await prisma.stockMovement.count({
    where: { companyId: company.id, reference: voidRef },
  })
  check("iptal hareketi yok", voidMoves === 0, `${voidMoves} hareket`)

  console.log("\n== Temizlik ==")
  const testRefs = [reference, unitRef, removeRef, factorRef]
  const moved = await prisma.stockMovement.groupBy({
    by: ["productId"],
    where: { companyId: company.id, reference: { in: testRefs } },
    _sum: { quantity: true },
  })
  for (const row of moved) {
    if (!row.productId) continue
    await prisma.product.update({
      where: { id: row.productId },
      data: { stockQuantity: { decrement: num(row._sum.quantity) } },
    })
    const ws = await prisma.warehouseStock.findFirst({
      where: { productId: row.productId },
      orderBy: { updatedAt: "desc" },
    })
    if (ws) {
      await prisma.warehouseStock.update({
        where: { id: ws.id },
        data: { quantity: { decrement: num(row._sum.quantity) } },
      })
    }
  }
  await prisma.stockMovement.deleteMany({
    where: { companyId: company.id, reference: { in: testRefs } },
  })
  const restored = num(
    (await prisma.product.findUnique({ where: { id: component.id } }))?.stockQuantity,
  )
  check("stok başlangıç değerine döndü", Math.abs(restored - before) < 0.0001, `${restored}`)
  check(
    "test hareketi kalmadı",
    (await prisma.stockMovement.count({
      where: { companyId: company.id, reference: { in: testRefs } },
    })) === 0,
  )

  console.log(`\n${fail === 0 ? "TÜMÜ GEÇTİ" : "BAŞARISIZ"} — ${pass} geçti, ${fail} kaldı\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
