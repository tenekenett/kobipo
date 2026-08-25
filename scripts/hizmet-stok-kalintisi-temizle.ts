/**
 * Hizmete çevrilmiş ürünlerde DONMUŞ stok bakiyelerini kapatır.
 *
 *   npx tsx scripts/hizmet-stok-kalintisi-temizle.ts           → yalnız listeler (kuru çalışma)
 *   npx tsx scripts/hizmet-stok-kalintisi-temizle.ts --uygula  → düzeltmeyi YAZAR
 *
 * Neden gerekli: hizmet kalemi hiçbir satış yolunda stok hareketi üretmez. Ürün,
 * bakiyesi varken hizmete çevrildiyse o bakiye kartta donar — ekranda bir sayı
 * durur ama bir daha asla değişmez. Kullanıcı bunu "sattım, stoğum düşmüyor"
 * diye yaşıyor (canlıda -99'a kadar hayalet bakiye birikmişti).
 *
 * Bundan sonrası için kapı kapatıldı: ürün hizmete çevrilirken bakiye otomatik
 * kapanıyor (app/api/stok/products/[id]/route.ts, PUT ve PATCH). Bu betik yalnız
 * GEÇMİŞ kalıntıyı temizler; tekrar çalıştırılabilir, temizse hiçbir şey yazmaz.
 *
 * Bakiye SİLİNMEZ, ters ADJUSTMENT hareketi yazılır: geçmiş satışların defterdeki
 * izi durur, düzeltme de hareket listesinde görünür.
 */
import { prisma } from "@/lib/db/prisma"
import { closeProductStock } from "@/lib/stock/warehouse"

const APPLY = process.argv.includes("--uygula")
const fmt = (v: unknown) =>
  Number(v ?? 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function main() {
  const services = await prisma.product.findMany({
    where: { isService: true },
    select: {
      id: true,
      name: true,
      companyId: true,
      stockQuantity: true,
      company: { select: { name: true } },
      warehouseStocks: { select: { warehouseId: true, quantity: true } },
    },
    orderBy: { name: "asc" },
  })

  // Kart bakiyesi 0 olsa bile depo satırı sıfırdan farklı olabilir (birbirini
  // götüren iki depo); ikisine de bakılır.
  const dirty = services.filter(
    (p) =>
      Number(p.stockQuantity) !== 0 ||
      p.warehouseStocks.some((w) => Number(w.quantity) !== 0),
  )

  console.log(`Hizmet kalemi: ${services.length} — kalıntı bakiyesi olan: ${dirty.length}\n`)
  if (dirty.length === 0) {
    console.log("Temiz, yapılacak bir şey yok.")
    return
  }

  for (const p of dirty) {
    const depo = p.warehouseStocks
      .filter((w) => Number(w.quantity) !== 0)
      .map((w) => fmt(w.quantity))
      .join(" + ")
    console.log(
      `   ${p.name}  kart ${fmt(p.stockQuantity)}${depo ? `  (depo: ${depo})` : "  (depo satırı yok)"}` +
        `  — ${p.company.name}`,
    )
  }

  if (!APPLY) {
    console.log(
      `\nKuru çalışma — hiçbir şey yazılmadı.` +
        `\nUygulamak için: npx tsx scripts/hizmet-stok-kalintisi-temizle.ts --uygula`,
    )
    return
  }

  console.log("\nUygulanıyor…\n")
  let hareket = 0
  for (const p of dirty) {
    const n = await closeProductStock(prisma, {
      companyId: p.companyId,
      productId: p.id,
      description: "Hizmet kalemi — donmuş stok bakiyesi kapatıldı (tek seferlik düzeltme)",
      createdBy: null,
    })
    hareket += n
    console.log(`   ✓ ${p.name}: ${fmt(p.stockQuantity)} → 0  (${n} hareket)`)
  }
  console.log(`\n${dirty.length} ürün kapatıldı, ${hareket} düzeltme hareketi yazıldı.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
