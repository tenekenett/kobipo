/**
 * Stok defterinin GEÇMİŞ bozukluklarını onarır (tek seferlik, tekrar çalıştırılabilir).
 *
 *   npx tsx scripts/stok-defteri-onar.ts           → yalnız rapor (kuru çalışma)
 *   npx tsx scripts/stok-defteri-onar.ts --uygula  → düzeltmeyi YAZAR
 *
 * İki ayrı bozukluk var, ikisi de aynı eski uçtan (`POST /api/stok/movements`,
 * ADJUSTMENT) geliyor. O uç artık farkı yazıyor ve depoyu güncelliyor; bu betik
 * yalnız ondan ÖNCE oluşmuş kayıtları toparlar.
 *
 * 1) MUTLAK YAZILMIŞ ADJUSTMENT SATIRLARI
 *    Eski uç, "stok kaç olsun" hedefini hareket miktarı olarak yazıyordu: deftere
 *    1.097 hedefi +1.097'lik bir hareket gibi düşüyordu. Hareket toplamı kartla
 *    ayrışıyor, hareket bazlı raporlar anlamsızlaşıyordu (canlıda bir üründe
 *    toplam 31,2 milyona çıkmıştı).
 *
 *    Onarım: ürünün hareketleri kronolojik gezilir, her eski ADJUSTMENT satırının
 *    miktarı "o andaki bakiyeye göre FARK" olarak yeniden yazılır. Satır SİLİNMEZ,
 *    tarihi/açıklaması korunur.
 *
 *    Eski satırlar depo da yazmadığı için (`warehouseId` NULL) onarımda ürünün
 *    bakiyesinin durduğu depoya bağlanır — hareket böylece atfedilebilir olur.
 *
 *    GÜVENLİK KURALI: yalnız "kart = son hedef + sonraki hareketler" özdeşliği
 *    tutuyorsa yazılır. Tutmuyorsa kartı başka bir şey de değiştirmiş demektir;
 *    o ürün ATLANIR ve raporda listelenir (elle bakılsın diye).
 *
 * 2) DEPO DÖKÜMÜ KARTLA AYRIŞMIŞ
 *    Eski uç kartı yazıp `warehouse_stocks`'a hiç dokunmuyordu → Σ(depo) ≠ kart
 *    (şema değişmezi: prisma/schema.prisma, WarehouseStock.quantity).
 *
 *    Onarım: fark, ürünün ana deposuna (en çok bakiyenin olduğu, yoksa varsayılan)
 *    doğrudan yazılır. Burada BİLEREK hareket üretilmez: olay zaten defterde var,
 *    ikinci kez hareket yazmak kartı da değiştirirdi. Kart otoriterdir.
 */
import { prisma } from "@/lib/db/prisma"
import { ensureDefaultWarehouseId } from "@/lib/stock/warehouse"

const APPLY = process.argv.includes("--uygula")
const n = (v: unknown) => Number(v ?? 0)
const r4 = (v: number) => Math.round(v * 10000) / 10000
const fmt = (v: unknown) =>
  n(v).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Ürünün bakiyesinin durduğu depo; hiç kaydı yoksa firmanın varsayılanı. */
async function anaDepo(companyId: string, productId: string): Promise<string> {
  const row = await prisma.warehouseStock.findFirst({
    where: { productId, warehouse: { companyId } },
    orderBy: { quantity: "desc" },
    select: { warehouseId: true },
  })
  return row?.warehouseId ?? (await ensureDefaultWarehouseId(prisma, companyId))
}

async function mutlakAdjustmentleriOnar() {
  console.log("── 1) Mutlak yazılmış ADJUSTMENT satırları ──\n")

  // Eski ucun imzası: ADJUSTMENT + depo YOK. İkram/zayi de ADJUSTMENT yazar ama
  // onlar hep bir depoya bağlıdır ve zaten FARK taşır — bu ayrım onları korur.
  const legacyAll = await prisma.stockMovement.findMany({
    where: { type: "ADJUSTMENT", warehouseId: null },
    select: { id: true, productId: true, quantity: true, createdAt: true, description: true },
  })
  // Ürünsüz hareket onarılamaz (hangi bakiyeye göre fark alınacağı yok).
  const legacy = legacyAll.filter((m) => Boolean(m.productId))
  if (legacy.length === 0) {
    console.log("   Eski (deposuz) ADJUSTMENT satırı yok.\n")
    return
  }

  const legacyIds = new Set(legacy.map((m) => m.id))
  const productIds = Array.from(new Set(legacy.map((m) => m.productId!)))
  console.log(`   ${legacy.length} satır / ${productIds.length} ürün\n`)

  let yazilan = 0
  const atlanan: string[] = []

  for (const productId of productIds) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, companyId: true, stockQuantity: true, company: { select: { name: true } } },
    })
    if (!product) continue

    const movements = await prisma.stockMovement.findMany({
      where: { productId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, quantity: true },
    })

    // Kronolojik gezinti: eski satırda kayıtlı değer HEDEF bakiyedir.
    let running = 0
    const yeni: { id: string; delta: number; hedef: number }[] = []
    for (const m of movements) {
      if (legacyIds.has(m.id)) {
        const hedef = n(m.quantity)
        yeni.push({ id: m.id, delta: r4(hedef - running), hedef })
        running = hedef
      } else {
        running = r4(running + n(m.quantity))
      }
    }

    const kart = n(product.stockQuantity)
    const uyumlu = Math.abs(r4(running - kart)) < 0.0001
    const etiket = `${product.name} — ${product.company.name}`

    if (!uyumlu) {
      atlanan.push(`${etiket}: yürüyen bakiye ${fmt(running)} ≠ kart ${fmt(kart)}`)
      console.log(`   ⚠ ATLANDI  ${etiket}`)
      console.log(`             yürüyen ${fmt(running)} ≠ kart ${fmt(kart)} — kartı başka bir şey de değiştirmiş`)
      continue
    }

    const whId = await anaDepo(product.companyId, product.id)
    for (const y of yeni) {
      console.log(
        `   ${APPLY ? "✓" : "·"} ${etiket}: hedef ${fmt(y.hedef)} → fark ${fmt(y.delta)}`,
      )
      if (APPLY) {
        await prisma.stockMovement.update({
          where: { id: y.id },
          data: { quantity: y.delta, warehouseId: whId },
        })
      }
      yazilan += 1
    }
  }

  console.log(
    `\n   ${yazilan} satır ${APPLY ? "yeniden yazıldı" : "yazılacak"}` +
      (atlanan.length ? `, ${atlanan.length} ürün atlandı` : "") + "\n",
  )
}

async function depoDokumunuEsitle() {
  console.log("── 2) Depo dökümü ile kart bakiyesi ──\n")

  const products = await prisma.product.findMany({
    where: { isService: false },
    select: {
      id: true,
      name: true,
      companyId: true,
      stockQuantity: true,
      company: { select: { name: true } },
      warehouseStocks: {
        select: { warehouseId: true, quantity: true, warehouse: { select: { companyId: true } } },
      },
    },
  })

  let duzeltilen = 0
  for (const p of products) {
    // Yalnız KENDİ firmasının depoları sayılır: başka firmanın deposuna düşmüş
    // satırlar ayrı bir sorun, burada toplama katılmaz.
    const own = p.warehouseStocks.filter((w) => w.warehouse.companyId === p.companyId)
    const depoTop = r4(own.reduce((s, w) => s + n(w.quantity), 0))
    const kart = n(p.stockQuantity)
    const fark = r4(kart - depoTop)
    if (Math.abs(fark) < 0.0001) continue

    const whId = await anaDepo(p.companyId, p.id)
    console.log(
      `   ${APPLY ? "✓" : "·"} ${p.name}: kart ${fmt(kart)} ↔ depo ${fmt(depoTop)}` +
        `  → ana depoya ${fmt(fark)} eklenir  — ${p.company.name}`,
    )
    if (APPLY) {
      await prisma.warehouseStock.upsert({
        where: { warehouseId_productId: { warehouseId: whId, productId: p.id } },
        create: { warehouseId: whId, productId: p.id, quantity: fark },
        update: { quantity: { increment: fark } },
      })
    }
    duzeltilen += 1
  }

  console.log(
    `\n   ${duzeltilen} ürün ${APPLY ? "eşitlendi" : "eşitlenecek"}` +
      (duzeltilen === 0 ? "  (Σ depo = kart, temiz)" : "") + "\n",
  )
}

/**
 * 3) BAŞKA FİRMANIN DEPOSUNA DÜŞMÜŞ SATIRLAR
 *
 * Depo id'si istemciden geliyordu ve sunucu sahipliğini doğrulamıyordu; firma
 * değiştiren bir ekranda eski depo id'si state'te kalınca stok başka firmanın
 * deposuna yazılabiliyordu. Kapı kapandı (resolveCompanyWarehouseId), kalıntı
 * burada temizlenir.
 *
 * MİKTARI 0 olanlar silinir: bakiye taşımazlar, yalnız "bu ürün şu depoda kayıtlı"
 * diye görünürler. Miktarı SIFIRDAN FARKLI olanlara DOKUNULMAZ — gerçek malı bir
 * firmadan diğerine taşımak veri onarımı değil, işletme kararıdır; raporlanır.
 */
async function yabanciDepoSatirlariniTemizle() {
  console.log("── 3) Başka firmanın deposundaki satırlar ──\n")

  const rows = await prisma.warehouseStock.findMany({
    select: {
      warehouseId: true,
      productId: true,
      quantity: true,
      product: { select: { name: true, companyId: true, company: { select: { name: true } } } },
      warehouse: { select: { name: true, companyId: true, company: { select: { name: true } } } },
    },
  })
  const yabanci = rows.filter((r) => r.product.companyId !== r.warehouse.companyId)

  if (yabanci.length === 0) {
    console.log("   Yok — her stok kendi firmasının deposunda.\n")
    return
  }

  let silinen = 0
  for (const r of yabanci) {
    const etiket =
      `"${r.product.name}" (${r.product.company.name}) → ` +
      `${r.warehouse.company.name} / ${r.warehouse.name}`
    if (n(r.quantity) === 0) {
      console.log(`   ${APPLY ? "✓" : "·"} ${etiket}: boş satır, silinir`)
      if (APPLY) {
        await prisma.warehouseStock.delete({
          where: { warehouseId_productId: { warehouseId: r.warehouseId, productId: r.productId } },
        })
      }
      silinen += 1
    } else {
      console.log(`   ⚠ ${etiket}: ${fmt(r.quantity)} bakiye var — ELLE karar verilmeli, dokunulmadı`)
    }
  }

  console.log(`\n   ${silinen} boş satır ${APPLY ? "silindi" : "silinecek"}\n`)
}

async function main() {
  await mutlakAdjustmentleriOnar()
  await depoDokumunuEsitle()
  await yabanciDepoSatirlariniTemizle()
  if (!APPLY) {
    console.log("Kuru çalışma — hiçbir şey yazılmadı.")
    console.log("Uygulamak için: npx tsx scripts/stok-defteri-onar.ts --uygula")
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
