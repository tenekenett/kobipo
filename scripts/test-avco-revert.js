require("dotenv").config({ path: ".env.local" })
require("dotenv").config()
const fs = require("node:fs")
const path = require("node:path")
const { PrismaClient } = require("@prisma/client")

/**
 * AVCO (ağırlıklı ortalama alış maliyeti) sorgusunun testleri.
 *
 * Test edilen hata: iptal/silinen alış faturasının fiyatı ortalamada KALIYORDU.
 * `revertStockByReference` alış hareketini silmez; aynı `reference` ile FİYATSIZ
 * bir ters hareket yazar. Eski sorgu yalnız fiyatlı IN satırlarını topladığı için
 * ters hareketi göremiyor, iptal edilmiş alış ortalamayı etkilemeye devam ediyordu.
 *
 * Çalıştırma:  node scripts/test-avco-revert.js
 *
 * DB gerektirir ama HİÇBİR ŞEY YAZMAZ: tüm senaryolar tek bir transaction içinde
 * kurulur ve sonunda bilerek geri sarılır (rollback). Ek olarak, koşulan SQL
 * lib/stock/cost.ts'ten OKUNUR — testin kopyası tutulmadığı için sorgu değişirse
 * test de onunla değişir.
 */

const prisma = new PrismaClient()

// ── lib/stock/cost.ts içindeki AVG_COST_SELECT gövdesini oku ────────────────────
function readAvgCostSelect() {
  const src = fs.readFileSync(path.join(process.cwd(), "lib", "stock", "cost.ts"), "utf8")
  const m = src.match(/const AVG_COST_SELECT = Prisma\.sql`([\s\S]*?)`\s*\n/)
  if (!m) throw new Error("lib/stock/cost.ts içinde AVG_COST_SELECT bulunamadı")
  return m[1]
}

// Eski (hatalı) sorgu — düzeltmenin gerçekten fark yarattığını göstermek için.
const OLD_SELECT = `
  SELECT p.id AS product_id,
         COALESCE(
           SUM(ABS(m.quantity) * m."unitPrice") / NULLIF(SUM(ABS(m.quantity)), 0),
           p."purchasePrice"
         ) AS unit_cost
  FROM products p
  LEFT JOIN stock_movements m
         ON m."productId" = p.id
        AND m."companyId" = p."companyId"
        AND m.type IN ('IN', 'PURCHASE')
        AND m."unitPrice" IS NOT NULL
        AND m.quantity <> 0
`

const NEW_SELECT = readAvgCostSelect()

async function costOf(db, select, companyId, productId) {
  const rows = await db.$queryRawUnsafe(
    `${select} WHERE p."companyId" = $1 AND p.id = $2 GROUP BY p.id, p."purchasePrice"`,
    companyId,
    productId,
  )
  const v = rows[0] ? rows[0].unit_cost : null
  return v == null ? null : Number(v)
}

// ── küçük test koşucusu ─────────────────────────────────────────────────────────
let pass = 0
let fail = 0
const round = (v) => (v == null ? null : Math.round(v * 1e6) / 1e6)

function check(label, actual, expected) {
  const a = round(actual)
  const e = round(expected)
  if (a === e) {
    pass++
    console.log(`  ✓ ${label} → ${a}`)
  } else {
    fail++
    console.log(`  ✗ ${label} → beklenen ${e}, gelen ${a}`)
  }
}

async function main() {
  const company = await prisma.company.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  })
  if (!company) throw new Error("Firma bulunamadı")
  console.log(`Test firması: ${company.name} (${company.id})\n`)

  const ROLLBACK = Symbol("rollback")

  try {
    await prisma.$transaction(
      async (tx) => {
        // Yalnız bu testin ürünü — gerçek veriye dokunulmuyor.
        const product = await tx.product.create({
          data: {
            companyId: company.id,
            name: `__AVCO TEST ${Date.now()}`,
            slug: `__avco-test-${Date.now()}`,
            unit: "KG",
            purchasePrice: 100,
            isSellable: false,
            isIngredient: true,
          },
          select: { id: true },
        })
        const pid = product.id

        const move = (type, quantity, unitPrice, reference) =>
          tx.stockMovement.create({
            data: {
              companyId: company.id,
              productId: pid,
              type,
              quantity,
              unitPrice: unitPrice ?? null,
              reference: reference ?? null,
              description: "AVCO testi",
            },
          })

        const nowCost = () => costOf(tx, NEW_SELECT, company.id, pid)
        const oldCost = () => costOf(tx, OLD_SELECT, company.id, pid)

        console.log("1) Hareketsiz ürün — elle girilen alış fiyatına düşer")
        check("hareket yok", await nowCost(), 100)

        console.log("\n2) İki alış faturası")
        await move("IN", 10, 50, "DOC-A")
        check("tek alış 10×50", await nowCost(), 50)
        await move("IN", 10, 100, "DOC-B")
        check("iki alış (10×50 + 10×100)", await nowCost(), 75)

        console.log("\n3) ASIL HATA — DOC-B iptal edilir (fiyatsız ters hareket)")
        await move("OUT", -10, null, "DOC-B")
        check("iptalden sonra yalnız DOC-A kalmalı", await nowCost(), 50)
        check("eski sorgu (hata hâlâ üretilebiliyor mu)", await oldCost(), 75)

        console.log("\n4) Kısmi geri alma — DOC-C 10×200, sonra 5 iade")
        await move("IN", 10, 200, "DOC-C")
        check("DOC-C tam (10×50 + 10×200)", await nowCost(), 125)
        await move("OUT", -5, null, "DOC-C")
        check("DOC-C yarısı geri (10×50 + 5×200)", await nowCost(), 100)

        console.log("\n5) Satış hareketleri ortalamayı ETKİLEMEZ")
        await move("OUT", -3, 300, "SALE-1") // satış fiyatı taşır
        check("satış sonrası", await nowCost(), 100)
        await move("IN", 3, null, "SALE-1") // satış iptali: fiyatsız IN
        check("satış iptali sonrası", await nowCost(), 100)

        console.log("\n6) Referanssız elle hareketler birbirini GÖTÜRMEZ")
        await move("IN", 10, 60, null) // elle giriş, fiyatlı
        check("elle giriş (10×50 + 5×200 + 10×60)", await nowCost(), 84)
        await move("OUT", -10, null, null) // fire/sayım farkı — iade DEĞİL
        check("fiyatsız elle çıkış ortalamayı bozmamalı", await nowCost(), 84)

        console.log("\n7) TRANSFER hareketi ortalamaya girmez")
        await move("TRANSFER", 5, 999, "TRF-1")
        check("transfer sonrası", await nowCost(), 84)

        console.log("\n8) Her şey geri alınırsa elle girilen fiyata döner")
        await move("OUT", -10, null, "DOC-A")
        await move("OUT", -5, null, "DOC-C")
        await move("OUT", -10, null, null) // 6'daki elle girişin referansı yok →
        // kendi belgesi sayılır, bu çıkış onu GÖTÜREMEZ (tasarım gereği).
        const afterAll = await nowCost()
        check("kalan: yalnız referanssız 10×60", afterAll, 60)

        console.log("\n9) Sorgu iskeletleri bozulmadı")
        const cte = await tx.$queryRawUnsafe(
          `WITH avg_cost AS (${NEW_SELECT} WHERE p."companyId" = $1 GROUP BY p.id, p."purchasePrice")
           SELECT COUNT(*)::int AS n FROM avg_cost`,
          company.id,
        )
        check("avgCostCte biçimi (CTE olarak derleniyor)", cte[0].n > 0 ? 1 : 0, 1)

        const many = await tx.$queryRawUnsafe(
          `${NEW_SELECT} WHERE p."companyId" = $1 AND p.id IN ($2) GROUP BY p.id, p."purchasePrice"`,
          company.id,
          pid,
        )
        check("resolveUnitCosts biçimi (IN listesi)", many.length, 1)

        throw ROLLBACK
      },
      { timeout: 30000, maxWait: 10000 },
    )
  } catch (e) {
    if (e !== ROLLBACK) throw e
  }

  // ── Gerçek veri: düzeltme hangi ürünlerin maliyetini değiştiriyor? ────────────
  console.log("\n10) Gerçek veride etki taraması (yalnızca okur)")
  const companies = await prisma.company.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  })
  let changed = 0
  for (const c of companies) {
    const oldRows = await prisma.$queryRawUnsafe(
      `${OLD_SELECT} WHERE p."companyId" = $1 GROUP BY p.id, p."purchasePrice"`,
      c.id,
    )
    const newRows = await prisma.$queryRawUnsafe(
      `${NEW_SELECT} WHERE p."companyId" = $1 GROUP BY p.id, p."purchasePrice"`,
      c.id,
    )
    const oldMap = new Map(oldRows.map((r) => [r.product_id, r.unit_cost == null ? null : Number(r.unit_cost)]))
    const diffs = []
    for (const r of newRows) {
      const nv = r.unit_cost == null ? null : Number(r.unit_cost)
      const ov = oldMap.get(r.product_id)
      if (round(nv) !== round(ov)) diffs.push({ id: r.product_id, ov, nv })
    }
    if (diffs.length > 0) {
      changed += diffs.length
      const names = await prisma.product.findMany({
        where: { id: { in: diffs.slice(0, 10).map((d) => d.id) } },
        select: { id: true, name: true },
      })
      const nameOf = new Map(names.map((n) => [n.id, n.name]))
      console.log(`  ${c.name}: ${diffs.length} üründe maliyet değişti`)
      for (const d of diffs.slice(0, 10)) {
        console.log(`    · ${nameOf.get(d.id) || d.id}: ${round(d.ov)} → ${round(d.nv)}`)
      }
    }
  }
  if (changed === 0) console.log("  (hiçbir firmada fark yok — bugüne kadar iptal edilmiş alış yok)")

  console.log(`\n${fail === 0 ? "TÜMÜ GEÇTİ" : "BAŞARISIZ"} — ${pass} geçti, ${fail} kaldı`)
  process.exitCode = fail === 0 ? 0 : 1
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
