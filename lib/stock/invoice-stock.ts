// Faturanın stok etkisini üreten ve yazan ORTAK katman.
//
// Neden ayrı dosya: fatura stoğu iki yerden doğuyor — oluşturma (POST
// /api/e-donusum/invoices) ve düzenleme (PUT .../invoices/[id]). Kural iki uçta
// ayrı yazılırsa biri reçete genişletmesini, diğeri hizmet filtresini kaçırır ve
// "faturayı düzenledim, stok eski kaldı" sınıfı hatalar doğar. Tek kapı:
//   prepareInvoiceStockOps() → ne hareket edecek (okuma)
//   writeInvoiceStockOps()   → hareketi yaz (transaction içinde)
// Okuma/yazma ayrı çünkü düzenleme, geri alma ile yeniden uygulamayı TEK
// transaction'da yapmak zorunda (yarıda kalırsa stok iki katına çıkardı).

import { prisma } from "@/lib/db/prisma"
import { adjustWarehouseStock, revertStockByReference } from "@/lib/stock/warehouse"
import { loadRecipeContext } from "@/lib/stock/recipe"
import { resolveUnitCosts } from "@/lib/stock/cost"
import {
  expandRecipeLines,
  hasActiveRecipe,
  type RecipeEffect,
} from "@/lib/stock/recipe-expand"

type ReadDb = Pick<typeof prisma, "product" | "productRecipe">
type WriteDb = Pick<typeof prisma, "warehouse" | "warehouseStock" | "product" | "stockMovement">

export type InvoiceStockType = "SALES" | "PURCHASE" | "RETURN"

/** Faturanın stok etkisi hesaplanırken kullanılan tek satır. */
export type InvoiceStockLine = {
  productId: string | null
  /** Pozitif miktar; yön (giriş/çıkış) fatura tipinden türetilir. */
  quantity: number
  /** Kalemin LİSTE birim fiyatı (KDV hariç, satır iskontosu DÜŞÜLMEMİŞ). */
  unitPrice: number | null
  /**
   * Satır iskontosu (`InvoiceItem.discountAmount`) — tutar, oran değil.
   *
   * Harekete yazılan fiyat bunun DÜŞÜLMÜŞ hâlidir: `stock_movements.unitPrice`
   * maliyet hesabının (AVCO) girdisidir ve iskontolu alınan malı liste
   * fiyatından saymak maliyeti gerçekte ödenenden yüksek gösterirdi. Alan boş
   * bırakılırsa iskonto yok sayılır (eski davranış).
   */
  discountAmount?: number | null
  /** Kalem sırası — reçete seçenek etkileri satıra özeldir, eşleme bununla yapılır. */
  order: number
  /** Restoran seçenekleri (porsiyon/ek malzeme). Yalnız satışta anlamlı. */
  recipeEffects?: RecipeEffect[]
  recipeFactor?: number
}

export type InvoiceStockOp = {
  productId: string
  /** İşaretli değişim: satışta negatif, alış/iadede pozitif. */
  delta: number
  unitPrice: number | null
  /** Reçeteden türeyenlerde "Reçete: <mamül>" eki; doğrudan düşümlerde null. */
  recipeNote: string | null
}

function normalizeType(type: string | null | undefined): InvoiceStockType | null {
  const safe = String(type || "").trim().toUpperCase()
  return safe === "SALES" || safe === "PURCHASE" || safe === "RETURN" ? safe : null
}

/**
 * Fatura malı depodan ÇIKARIYOR mu?
 *
 * `type` tek başına yetmez: iade iki yönlüdür. Müşteri malı geri verdiyse
 * (satış iadesi) mal depoya GİRER; malı tedarikçiye geri gönderdiysek (alış
 * iadesi) depodan ÇIKAR. Yön `Invoice.returnKind` sütununda durur.
 *
 * `returnKind` NULL = satış iadesi: sütun eklenmeden önce kesilmiş iadeler o gün
 * tek yönlüydü ve stoğu artırıyordu; NULL'ı giriş saymak onların davranışını
 * birebir korur.
 */
export function isOutboundInvoice(
  type: string | null | undefined,
  returnKind?: string | null,
): boolean {
  const safe = normalizeType(type)
  if (safe === "SALES") return true
  if (safe === "RETURN") return String(returnKind || "").trim().toUpperCase() === "PURCHASE"
  return false
}

/**
 * Harekete YAZILACAK birim fiyat: satır iskontosu düşülmüş net.
 *
 * `stock_movements.unitPrice` maliyet ortalamasının (AVCO, lib/stock/cost.ts)
 * tek girdisidir. Buraya liste fiyatı yazıldığı sürece iskontolu alınan mal
 * ortalamayı gerçekte ödenenin ÜSTÜNE çekiyordu — kullanıcı kârını olduğundan
 * düşük görüyordu.
 *
 * Fatura ALTI iskonto kaleme dağıtılmadığı için buraya GİRMEZ; maliyet o kadarlık
 * bir payla hâlâ yüksek kalabilir, yani sapmanın yönü güvenli tarafta.
 *
 * GEÇMİŞE DÖNÜK DEĞİLDİR: zaten yazılmış hareketler liste fiyatını taşımaya devam
 * eder. İlgili fatura düzenlenip kaydedildiğinde hareketler yeniden yazılır ve
 * kendiliğinden düzelir (bkz. revertStockByReference + writeInvoiceStockOps).
 */
function netUnitPrice(
  unitPrice: number | null | undefined,
  quantity: number,
  discountAmount: number | null | undefined,
): number | null {
  if (unitPrice == null) return null
  const price = Number(unitPrice)
  if (!Number.isFinite(price)) return null
  const discount = Number(discountAmount)
  if (!Number.isFinite(discount) || discount === 0) return price
  if (!Number.isFinite(quantity) || quantity <= 0) return price
  const net = (price * quantity - discount) / quantity
  // İskonto satır tutarını aşarsa (veri hatası) fiyatı EKSİYE düşürmek yerine
  // liste fiyatında bırak: negatif maliyet ortalamayı sessizce bozardı.
  return Number.isFinite(net) && net >= 0 ? net : price
}

function stockLineKey(productId: string | null, quantity: number, unitPrice: number) {
  return `${productId || ""}|${quantity.toFixed(4)}|${unitPrice.toFixed(4)}`
}

/**
 * Düzenleme faturanın STOK etkisini değiştiriyor mu?
 *
 * Yalnız ürün + miktar + birim fiyat üçlüsüne bakar: açıklama/KDV/iskonto
 * değişikliği deftere yansımaz, birim fiyat ise AVCO maliyetine girdiği için
 * yansır (bkz. lib/stock/cost.ts). Satır sırası önemsizdir.
 *
 * "Değişmediyse dokunma" bilinçli: her kaydetmede geri alma + yeniden yazma çifti
 * üretmek hareket listesini şişirir ve AVCO ortalamasını eski fiyatla harmanlar.
 */
export function sameStockLines(
  prev: Array<{ productId: string | null; quantity: unknown; unitPrice: unknown }>,
  next: Array<{ productId: string | null; quantity: number; unitPrice: number }>,
): boolean {
  if (prev.length !== next.length) return false
  const before = prev
    .map((i) => stockLineKey(i.productId, Number(i.quantity) || 0, Number(i.unitPrice) || 0))
    .sort()
  const after = next
    .map((i) => stockLineKey(i.productId, Number(i.quantity) || 0, Number(i.unitPrice) || 0))
    .sort()
  return before.every((key, index) => key === after[index])
}

/**
 * Faturanın kalemlerinden yazılacak stok hareketlerini üretir. SADECE OKUR.
 *
 * - Yön: Satış → çıkış (−), Alış → giriş (+). İADE İKİ YÖNLÜDÜR: satış iadesi
 *   giriş (müşteri geri verdi), alış iadesi çıkış (tedarikçiye geri verdik) —
 *   bkz. `isOutboundInvoice`.
 * - REÇETE GENİŞLETME yalnız SATIŞ'ta: reçetesi olan mamül (Latte) kendi
 *   stoğundan DÜŞMEZ, bileşenlerine açılır ve bileşenin de reçetesi varsa
 *   hammaddeye kadar inilir. Alış/iade genişletilmez: mal olarak ne alındıysa o girer.
 * - Hizmet (isService) ürünleri elenir — genişletmeden SONRA, aksi halde reçeteli
 *   bir menü ürünü hizmet sayılıp bileşenleri hiç düşmeden atlanabilirdi.
 */
export async function prepareInvoiceStockOps(
  db: ReadDb,
  args: {
    companyId: string
    type: string | null | undefined
    /** İade yönü (`Invoice.returnKind`) — yalnız type=RETURN'de anlamlı. */
    returnKind?: string | null
    lines: InvoiceStockLine[]
    /** Hata günlüğünde faturayı tanımak için (opsiyonel). */
    invoiceNo?: string | null
  },
): Promise<InvoiceStockOp[]> {
  const safeType = normalizeType(args.type)
  if (!safeType) return []

  type Base = { productId: string; delta: number; unitPrice: number | null; order: number }
  const baseItems: Base[] = args.lines
    .map((line) => {
      if (!line.productId) return null
      const quantity = Number(line.quantity) || 0
      const delta = isOutboundInvoice(safeType, args.returnKind) ? -quantity : quantity
      if (delta === 0) return null
      return {
        productId: line.productId,
        delta,
        unitPrice: netUnitPrice(line.unitPrice, quantity, line.discountAmount),
        order: Number(line.order) || 0,
      }
    })
    .filter((x): x is Base => x !== null)

  if (baseItems.length === 0) return []

  let ops: InvoiceStockOp[] = baseItems.map((s) => ({
    productId: s.productId,
    delta: s.delta,
    unitPrice: s.unitPrice,
    recipeNote: null,
  }))

  if (safeType === "SALES") {
    try {
      const { recipes, unitOf } = await loadRecipeContext(db, args.companyId)

      // Yalnızca reçetesi OLAN kalemler genişleticiye girer; kalanlar dokunulmadan
      // geçer. Böylece reçetesiz ürünlerin davranışı BİREBİR korunur — aynı üründen
      // iki satır varsa yine iki ayrı hareket, her biri kendi birim fiyatıyla yazılır
      // (genişletici bunları tek satırda toplardı).
      const lineByOrder = new Map(args.lines.map((l) => [Number(l.order) || 0, l]))
      const extrasOf = (order: number) => {
        const line = lineByOrder.get(order)
        if (!line) return null
        const effects = line.recipeEffects ?? []
        const factor = Number(line.recipeFactor) > 0 ? Number(line.recipeFactor) : 1
        if (effects.length === 0 && factor === 1) return null
        return { effects, recipeFactor: factor }
      }

      const willExpand = (id: string) => hasActiveRecipe(recipes, id)
      const toExpand = baseItems.filter((s) => willExpand(s.productId))
      const passthrough = baseItems.filter((s) => !willExpand(s.productId))
      // Reçetesiz ama seçeneğinde EK MALZEME olan satırlar ("kutu kola + pipet"):
      // ürünün kendisi yukarıdaki gibi satır satır geçer, yalnız ek malzemesi
      // genişletilir (`expandBase: false`).
      const effectsOnly = passthrough.filter((s) => extrasOf(s.order))

      if (toExpand.length > 0 || effectsOnly.length > 0) {
        const { direct, components, errors } = expandRecipeLines({
          // baseItems'ta satış deltası negatiftir; genişletme pozitif miktar bekler.
          lines: [
            ...toExpand.map((s) => ({
              productId: s.productId,
              quantity: -s.delta,
              effects: extrasOf(s.order)?.effects,
              recipeFactor: extrasOf(s.order)?.recipeFactor,
            })),
            ...effectsOnly.map((s) => ({
              productId: s.productId,
              quantity: -s.delta,
              effects: extrasOf(s.order)?.effects,
              expandBase: false,
            })),
          ],
          recipes,
          unitOf,
        })

        if (errors.length > 0) {
          // Satışı ENGELLEME (stok hatası hiçbir zaman fişi bloklamaz), ama sessiz
          // kalma — bozuk reçete fark edilebilsin.
          console.error("[Reçete] Genişletme hataları:", args.invoiceNo || "", errors)
        }

        const unitPriceByProduct = new Map(baseItems.map((s) => [s.productId, s.unitPrice]))
        // Maliyet AVCO'dan gelir (lib/stock/cost.ts) — reçete ekranının marj
        // önizlemesiyle AYNI tanım, böylece ekranda görülen maliyet ile donan
        // maliyet çelişmez.
        const costs = await resolveUnitCosts(
          args.companyId,
          components.map((c) => c.productId),
        )
        const sourceIds = Array.from(new Set(components.flatMap((c) => c.sources)))
        const sourceNames = new Map(
          sourceIds.length > 0
            ? (
                await db.product.findMany({
                  where: { id: { in: sourceIds } },
                  select: { id: true, name: true },
                })
              ).map((p) => [p.id, p.name] as const)
            : [],
        )

        ops = [
          // Reçetesiz kalemler: satır satır, dokunulmamış.
          ...passthrough.map((s) => ({
            productId: s.productId,
            delta: s.delta,
            unitPrice: s.unitPrice,
            recipeNote: null,
          })),
          // Güvenlik ağı: normalde boştur (genişleticiye yalnızca reçeteli kalemler
          // girdi), ama reçete boşalmış bir kenar durumda kalem kaybolmasın.
          ...direct.map((d) => ({
            productId: d.productId,
            delta: -d.quantity,
            unitPrice: unitPriceByProduct.get(d.productId) ?? null,
            recipeNote: null,
          })),
          ...components.map((c) => ({
            productId: c.productId,
            delta: -c.quantity,
            // Maliyet burada DONDURULUR: sonradan gelen zam geçmiş karlılığı bozmasın.
            unitPrice: costs.get(c.productId) ?? null,
            recipeNote: `Reçete: ${c.sources.map((id) => sourceNames.get(id) ?? id).join(", ")}`,
          })),
        ]
      }
    } catch (recipeError) {
      // Reçete katmanı çökerse satış, genişletme öncesi davranışla devam eder.
      console.error("[Reçete] Genişletme başarısız, ham kalemlerle devam ediliyor:", recipeError)
    }
  }

  // Hizmet ürünleri stok takibi yapmaz → hareket oluşturma.
  const productIds = Array.from(new Set(ops.map((s) => s.productId)))
  const serviceProductIds = new Set(
    productIds.length > 0
      ? (
          await db.product.findMany({
            where: { id: { in: productIds }, isService: true },
            select: { id: true },
          })
        ).map((p) => p.id)
      : [],
  )

  return ops.filter((s) => !serviceProductIds.has(s.productId))
}

/**
 * Hazırlanan hareketleri deftere yazar. Transaction'ı ÇAĞIRAN açar: düzenlemede
 * geri alma + yeniden uygulama aynı transaction'da olmak zorundadır.
 *
 * Reçeteden türeyen bileşen hareketleri de AYNI reference (invoice.id) ile yazılır —
 * böylece fiş iptalinde `revertStockByReference` hammaddeyi kendiliğinden geri verir
 * ve reçete sonradan değişse bile geri alma KAYITLI harekete göre yapılır.
 * Bkz. docs/restoran/PLAN.md "Adım 4".
 */
export async function writeInvoiceStockOps(
  db: WriteDb,
  args: {
    companyId: string
    invoiceId: string
    invoiceNo?: string | null
    type: string | null | undefined
    /** İade yönü (`Invoice.returnKind`) — yalnız type=RETURN'de anlamlı. */
    returnKind?: string | null
    warehouseId: string
    ops: InvoiceStockOp[]
    createdBy?: string | null
  },
): Promise<void> {
  const safeType = normalizeType(args.type)
  if (!safeType || args.ops.length === 0) return

  const outbound = isOutboundInvoice(safeType, args.returnKind)
  const label =
    safeType === "SALES"
      ? "Satış"
      : safeType === "PURCHASE"
        ? "Satın alma"
        : outbound
          ? "Alış iadesi"
          : "Satış iadesi"

  for (const op of args.ops) {
    await adjustWarehouseStock(db, {
      companyId: args.companyId,
      productId: op.productId,
      warehouseId: args.warehouseId,
      delta: op.delta,
      type: outbound ? "OUT" : "IN",
      unitPrice: op.unitPrice,
      // Reçeteden türeyen hareketler "Reçete:" ile işaretlenir — karlılık ve
      // hammadde tüketim raporları bunları doğrudan satıştan böyle ayırır.
      description: op.recipeNote
        ? `${args.invoiceNo || args.invoiceId} - ${op.recipeNote}`
        : `${args.invoiceNo || args.invoiceId} - ${label} faturası`,
      reference: args.invoiceId,
      createdBy: args.createdBy ?? null,
    })
  }
}

/**
 * Faturanın önceki stok etkisini geri alır (düzenleme için). Yeni hareketler
 * `writeInvoiceStockOps` ile AYNI transaction'da yazılmalı — arada kalırsa mal
 * depoda yokmuş gibi görünür.
 *
 * Neden delta değil de "geri al + yeniden yaz": ürün değişimi, satır silme veya
 * depo farkı gibi durumlarda delta mantığı sessizce yanlış sonuç verir. Geri alma
 * reference bazlı ve idempotenttir (bkz. revertStockByReference).
 */
export async function revertInvoiceStockForEdit(
  tx: WriteDb,
  args: {
    companyId: string
    invoiceId: string
    invoiceNo?: string | null
    createdBy?: string | null
  },
): Promise<void> {
  await revertStockByReference(tx, {
    companyId: args.companyId,
    reference: args.invoiceId,
    description: `${args.invoiceNo || args.invoiceId} - Fatura düzenlendi (eski stok geri alındı)`,
    createdBy: args.createdBy ?? null,
  })
}

/**
 * Faturanın stoğunun hangi depoda tutulduğunu bulur: kendi hareketlerinin yazıldığı
 * ilk depo. Fatura kaydında depo alanı yok — düzenlemede stok, oluşturmanın düştüğü
 * depoya geri yazılmalı, varsayılana kaymamalı.
 */
export async function resolveInvoiceWarehouseId(
  db: Pick<typeof prisma, "stockMovement">,
  args: { companyId: string; invoiceId: string },
): Promise<string | null> {
  const first = await db.stockMovement.findFirst({
    where: {
      companyId: args.companyId,
      reference: args.invoiceId,
      warehouseId: { not: null },
    },
    orderBy: { createdAt: "asc" },
    select: { warehouseId: true },
  })
  return first?.warehouseId ?? null
}
