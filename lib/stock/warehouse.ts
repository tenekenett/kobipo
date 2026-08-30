import { prisma } from "@/lib/db/prisma"
import { planOpeningStock } from "@/lib/stock/opening-stock"

// PrismaClient veya $transaction içindeki client — ikisi de model metodlarını taşır.
type Db = Pick<typeof prisma, "warehouse" | "warehouseStock" | "product" | "stockMovement">

/**
 * Miktarların ortak hassasiyeti: 4 ondalık (Product.stockQuantity ile aynı).
 * Ondalıklı kayan nokta toplamları burada kırpılmazsa 0.1 + 0.2 gibi işlemler
 * bakiyeye 0.30000000000000004 yazar ve "eşit mi" karşılaştırmaları bozulur.
 */
const round4 = (n: number) => Math.round(n * 10000) / 10000

/** Firmanın varsayılan deposunu döndürür; yoksa "Ana Depo" oluşturur. */
export async function ensureDefaultWarehouseId(db: Db, companyId: string): Promise<string> {
  const def = await db.warehouse.findFirst({
    where: { companyId, isActive: true, isDefault: true },
    select: { id: true },
  })
  if (def) return def.id

  const any = await db.warehouse.findFirst({
    where: { companyId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  })
  if (any) return any.id

  const created = await db.warehouse.create({
    data: { companyId, code: "ANA", name: "Ana Depo", isDefault: true },
    select: { id: true },
  })
  return created.id
}

/**
 * Eski (hiçbir depoya atanmamış) ürün stoğunu, ilk kez depo işlemi yapıldığında
 * varsayılan depoya materyalize eder. Böylece Σ(WarehouseStock) = Product.stockQuantity
 * değişmezi korunur ve geçmiş veriler kaybolmaz.
 */
async function materializeLegacyStock(db: Db, companyId: string, productId: string) {
  const rows = await db.warehouseStock.findMany({
    where: { productId },
    select: { id: true },
    take: 1,
  })
  if (rows.length > 0) return // zaten depoya dağıtılmış

  const product = await db.product.findUnique({
    where: { id: productId },
    select: { stockQuantity: true },
  })
  const current = Number(product?.stockQuantity || 0)
  if (current === 0) return

  const defId = await ensureDefaultWarehouseId(db, companyId)
  await db.warehouseStock.upsert({
    where: { warehouseId_productId: { warehouseId: defId, productId } },
    create: { warehouseId: defId, productId, quantity: current },
    update: { quantity: { increment: current } },
  })
}

/**
 * Belirli bir depo+ürün için stok değişimini uygular (depo bazlı + toplam + hareket).
 * delta: + giriş, - çıkış. warehouseId verilmezse varsayılan depo kullanılır.
 */
export async function adjustWarehouseStock(
  db: Db,
  args: {
    companyId: string
    productId: string
    warehouseId?: string | null
    delta: number
    type: string // IN | OUT | TRANSFER | ADJUSTMENT | SALE | PURCHASE ...
    unitPrice?: number | null
    description?: string | null
    reference?: string | null
    createdBy?: string | null
    /** Hareketten sorumlu İK kartı — bugün yalnız ikram düzeltmesi doldurur. */
    employeeId?: string | null
    /**
     * Hareketin TARİHİ (`createdAt`). Verilmezse "şimdi".
     *
     * Elle girilen giriş/çıkış fişleri için var: mal dün geldi, kayıt bugün
     * yapılıyor ve stok raporları dönemi `createdAt`ten süzüyor. Belge kaynaklı
     * hareketler (fatura, adisyon) bunu KULLANMAZ — onların tarihi belgenin
     * kendi kaydıyla birlikte doğar. Bkz. lib/stock/movement-date.ts.
     */
    date?: Date | null
  },
): Promise<void> {
  const warehouseId = args.warehouseId || (await ensureDefaultWarehouseId(db, args.companyId))

  await materializeLegacyStock(db, args.companyId, args.productId)

  await db.warehouseStock.upsert({
    where: { warehouseId_productId: { warehouseId, productId: args.productId } },
    create: { warehouseId, productId: args.productId, quantity: args.delta },
    update: { quantity: { increment: args.delta } },
  })

  await db.product.update({
    where: { id: args.productId },
    data: { stockQuantity: { increment: args.delta } },
  })

  await db.stockMovement.create({
    data: {
      companyId: args.companyId,
      warehouseId,
      productId: args.productId,
      type: args.type,
      quantity: args.delta,
      unitPrice: args.unitPrice ?? null,
      description: args.description ?? null,
      reference: args.reference ?? null,
      createdBy: args.createdBy ?? null,
      employeeId: args.employeeId ?? null,
      // undefined → şema varsayılanı (now). null yazmak sütunu bozardı.
      ...(args.date ? { createdAt: args.date } : {}),
    },
  })
}

/**
 * Bir faturanın stok etkisini geri alır (iptal/silme için). Faturaya ait
 * (reference = invoiceId) tüm stok hareketlerinin depo bazında NET'ini alıp
 * tersini `adjustWarehouseStock` üzerinden uygular. Avantajları:
 *  - Stok, oluşturmanın düştüğü DOĞRU depoya geri yazılır (Invoice'ta depo alanı yok).
 *  - Σ(WarehouseStock) = Product.stockQuantity değişmezi korunur (tek kapı).
 *  - İDEMPOTENT: geri alma hareketleri de aynı reference ile yazıldığından ikinci
 *    çağrıda net zaten 0 olur ve tekrar etki etmez. Böylece "iptal sonra silme"
 *    gibi durumlarda stok çift geri alınmaz.
 */
export async function revertStockByReference(
  db: Db,
  args: {
    companyId: string
    reference: string
    description?: string | null
    createdBy?: string | null
  },
): Promise<void> {
  const grouped = await db.stockMovement.groupBy({
    by: ["productId", "warehouseId"],
    where: { companyId: args.companyId, reference: args.reference },
    _sum: { quantity: true },
  })

  for (const row of grouped) {
    if (!row.productId) continue
    const net = Number(row._sum.quantity || 0)
    if (net === 0) continue
    await adjustWarehouseStock(db, {
      companyId: args.companyId,
      productId: row.productId,
      warehouseId: row.warehouseId,
      delta: -net,
      type: net < 0 ? "IN" : "OUT",
      description: args.description ?? null,
      reference: args.reference,
      createdBy: args.createdBy ?? null,
    })
  }
}

export async function revertInvoiceStock(
  db: Db,
  args: {
    companyId: string
    invoiceId: string
    invoiceNo?: string | null
    createdBy?: string | null
  },
): Promise<void> {
  await revertStockByReference(db, {
    companyId: args.companyId,
    reference: args.invoiceId,
    description: `${args.invoiceNo || args.invoiceId} - Fatura iptali (stok iade)`,
    createdBy: args.createdBy ?? null,
  })
}

/**
 * İki depo arasında stok taşır. Toplam (Product.stockQuantity) DEĞİŞMEZ; yalnızca
 * depo dağılımı değişir. Her iki tarafa TRANSFER hareketi yazar.
 */
export async function transferWarehouseStock(
  db: Db,
  args: {
    companyId: string
    productId: string
    fromWarehouseId: string
    toWarehouseId: string
    quantity: number // pozitif
    description?: string | null
    createdBy?: string | null
  },
): Promise<void> {
  const qty = Math.abs(args.quantity)
  if (qty === 0 || args.fromWarehouseId === args.toWarehouseId) return

  await materializeLegacyStock(db, args.companyId, args.productId)

  // Kaynak depodan çıkış
  await db.warehouseStock.upsert({
    where: { warehouseId_productId: { warehouseId: args.fromWarehouseId, productId: args.productId } },
    create: { warehouseId: args.fromWarehouseId, productId: args.productId, quantity: -qty },
    update: { quantity: { decrement: qty } },
  })
  // Hedef depoya giriş
  await db.warehouseStock.upsert({
    where: { warehouseId_productId: { warehouseId: args.toWarehouseId, productId: args.productId } },
    create: { warehouseId: args.toWarehouseId, productId: args.productId, quantity: qty },
    update: { quantity: { increment: qty } },
  })

  const desc = args.description || "Depo transferi"
  await db.stockMovement.createMany({
    data: [
      { companyId: args.companyId, warehouseId: args.fromWarehouseId, productId: args.productId, type: "TRANSFER", quantity: -qty, description: desc, createdBy: args.createdBy ?? null },
      { companyId: args.companyId, warehouseId: args.toWarehouseId, productId: args.productId, type: "TRANSFER", quantity: qty, description: desc, createdBy: args.createdBy ?? null },
    ],
  })
}

/**
 * Ürünün stok bakiyesini SIFIRLAR — her deposu için ayrı bir ADJUSTMENT hareketi
 * yazarak. Ürün hizmete çevrildiğinde çağrılır.
 *
 * Neden gerekli: hizmet kalemi hiçbir satış yolunda stok hareketi üretmez
 * (lib/stock/invoice-stock.ts hizmetleri eler). Ürün, bakiyesi varken hizmete
 * çevrilirse o bakiye kartta DONAR: ekranda bir sayı durur ama bir daha asla
 * değişmez. Kullanıcı bunu "sattım, stoğum düşmüyor" diye yaşıyor — canlıda
 * hizmete çevrilmiş kalemlerde -99'a kadar hayalet bakiye birikmişti.
 *
 * Neden depo depo: tek hareketle kartı sıfırlamak Σ(WarehouseStock) =
 * Product.stockQuantity değişmezini korurdu ama depo dökümünde birbirini götüren
 * artık satırlar bırakırdı (A: +5, B: -5). Her depoyu kendi içinde kapatıyoruz.
 *
 * Hareket SİLİNMEZ, ters hareket yazılır: geçmiş satışların defterdeki izi kalır.
 */
export async function closeProductStock(
  db: Db,
  args: {
    companyId: string
    productId: string
    description: string
    createdBy?: string | null
  },
): Promise<number> {
  const product = await db.product.findUnique({
    where: { id: args.productId },
    select: { stockQuantity: true },
  })
  let remaining = Number(product?.stockQuantity || 0)

  const rows = await db.warehouseStock.findMany({
    where: { productId: args.productId, warehouse: { companyId: args.companyId } },
    select: { warehouseId: true, quantity: true },
  })

  let closed = 0
  for (const row of rows) {
    const qty = Number(row.quantity)
    if (qty === 0) continue
    await adjustWarehouseStock(db, {
      companyId: args.companyId,
      productId: args.productId,
      warehouseId: row.warehouseId,
      delta: -qty,
      type: "ADJUSTMENT",
      description: args.description,
      createdBy: args.createdBy ?? null,
    })
    remaining -= qty
    closed += 1
  }

  // Hiç depo satırı olmayan eski kayıtlarda bakiye yalnız kartta durur; kalanı
  // varsayılan depoda kapat (adjustWarehouseStock önce onu depoya materyalize eder).
  remaining = Math.round(remaining * 10000) / 10000
  if (remaining !== 0) {
    await adjustWarehouseStock(db, {
      companyId: args.companyId,
      productId: args.productId,
      delta: -remaining,
      type: "ADJUSTMENT",
      description: args.description,
      createdBy: args.createdBy ?? null,
    })
    closed += 1
  }

  return closed
}

/**
 * İstemciden gelen depo id'sini FİRMAYA GÖRE doğrular; geçersizse güvenli bir
 * depoya düşer.
 *
 * Neden: depo id'si ekranlardan gövdede geliyor ve firma değiştiren bir panelde
 * eski firmanın deposu bileşen state'inde kalabiliyor. Doğrulanmadığında FK
 * geçerli olduğu için yazma sessizce BAŞARILI olur ve stok başka firmanın
 * deposuna düşer — canlıda böyle satırlar oluştu.
 *
 * Neden 400 değil: bunlar tezgâh ekranları; kasada duran müşteriyi bayat bir
 * state yüzünden bekletmek yerine varsayılan depoya yazıp çağıranın kullanıcıyı
 * UYARMASINI sağlıyoruz (`rejected`). Sessiz düzeltme de yapmıyoruz.
 */
export async function resolveCompanyWarehouseId(
  db: Db,
  args: { companyId: string; requestedId?: string | null; productId?: string | null },
): Promise<{ warehouseId: string; rejected: boolean }> {
  const requested = args.requestedId ? String(args.requestedId).trim() : ""
  if (requested) {
    const own = await db.warehouse.findFirst({
      where: { id: requested, companyId: args.companyId },
      select: { id: true },
    })
    if (own) return { warehouseId: own.id, rejected: false }
  }

  // Ürün verildiyse onun bakiyesinin durduğu depo, yoksa firmanın varsayılanı.
  if (args.productId) {
    const row = await db.warehouseStock.findFirst({
      where: { productId: args.productId, warehouse: { companyId: args.companyId } },
      orderBy: { quantity: "desc" },
      select: { warehouseId: true },
    })
    if (row) return { warehouseId: row.warehouseId, rejected: Boolean(requested) }
  }

  return {
    warehouseId: await ensureDefaultWarehouseId(db, args.companyId),
    rejected: Boolean(requested),
  }
}

/**
 * Açılış hareketinin açıklaması. Ürün kartı oluşturulurken girilen başlangıç
 * miktarı bu açıklamayla yazılır; "başlangıç stoğunu değiştir" akışı da onu
 * bulmak için buna bakar. Sabit metin bilinçli: hareket tablosunda "bu satır
 * açılıştır" diyen ayrı bir sütun yok ve sütun eklemek eski kayıtları yine de
 * sınıflandırmazdı (bkz. lib/stock/opening-stock.ts).
 */
export const OPENING_STOCK_DESCRIPTION = "Açılış stoğu"

export type OpeningStockInfo = {
  /** Açılış hareketinin id'si; eski kayıtlarda null. */
  movementId: string | null
  /** Açılış miktarı — hareket yoksa karttan türetilen kalıntı. */
  quantity: number
  unitPrice: number | null
  warehouseId: string | null
  date: Date | null
  /** Açılış defterde bir hareketle temsil ediliyor mu? */
  tracked: boolean
}

/** Ürünün açılış hareketi (varsa). */
async function findOpeningMovement(db: Db, companyId: string, productId: string) {
  return db.stockMovement.findFirst({
    where: {
      companyId,
      productId,
      type: "IN",
      description: OPENING_STOCK_DESCRIPTION,
      // Belgeye bağlı hareket açılış olamaz. Bugün fatura açıklaması bu metni
      // taşımıyor; koşul, ileride biri aynı metni kullanırsa karışmasın diye.
      reference: null,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, quantity: true, unitPrice: true, warehouseId: true, createdAt: true },
  })
}

/**
 * Ürünün açılış stoğu. Hareketi yoksa miktar KALINTIDAN okunur
 * (kart − Σ hareketler) — gerekçesi lib/stock/opening-stock.ts başında.
 */
export async function getOpeningStock(
  db: Db,
  companyId: string,
  productId: string,
): Promise<OpeningStockInfo> {
  const [movement, agg, product] = await Promise.all([
    findOpeningMovement(db, companyId, productId),
    db.stockMovement.aggregate({ where: { companyId, productId }, _sum: { quantity: true } }),
    db.product.findUnique({ where: { id: productId }, select: { stockQuantity: true } }),
  ])

  if (movement) {
    return {
      movementId: movement.id,
      quantity: Number(movement.quantity),
      unitPrice: movement.unitPrice == null ? null : Number(movement.unitPrice),
      warehouseId: movement.warehouseId,
      date: movement.createdAt,
      tracked: true,
    }
  }

  const residual = round4(
    Number(product?.stockQuantity || 0) - Number(agg._sum.quantity || 0),
  )
  return {
    movementId: null,
    quantity: residual,
    unitPrice: null,
    warehouseId: null,
    date: null,
    tracked: false,
  }
}

/**
 * Açılış stoğunu YENİDEN BELİRLER: hareketin miktarını hedefe çeker, farkı karta
 * ve depo satırına işler.
 *
 * Neden ters hareket değil de yerinde düzeltme: açılış "olmuş bir olay" değil,
 * kartın başlangıç noktasıdır. Yanlış girilmiş bir başlangıcı ADJUSTMENT ile
 * kapatmak defterde hiç yaşanmamış bir hikâye bırakır ("1 Ocak'ta 100 girdi,
 * 1 Ocak'ta 20 düzeltildi") ve envanter ilk günden yanlış açılır. Kural YALNIZ
 * açılışa özeldir: satış, fatura ve sayım hareketleri hâlâ silinmez, ters
 * hareketle kapatılır.
 *
 * Hareket YOKSA (0 stokla açılmış ürün ya da tek kapı öncesi eski kayıt)
 * oluşturulur; o durumda karta yalnız FARK işlenir, hareketin miktarı ise
 * HEDEFTİR. İkisinin neden ayrı olduğu için bkz. planOpeningStock.
 */
export async function setOpeningStock(
  db: Db,
  args: {
    companyId: string
    productId: string
    /** Yeni açılış miktarı (>= 0). */
    quantity: number
    /** Açılış birim maliyeti — ortalama maliyete (AVCO) girer. */
    unitPrice?: number | null
    /** Açılışın yazılacağı depo. Verilmezse hareketin mevcut deposu korunur. */
    warehouseId?: string | null
    /** Açılış tarihi. Verilmezse hareketin mevcut tarihi korunur. */
    date?: Date | null
    createdBy?: string | null
  },
): Promise<
  | { ok: true; openingQuantity: number; stockQuantity: number; delta: number }
  | { ok: false; error: string }
> {
  const product = await db.product.findUnique({
    where: { id: args.productId },
    select: { stockQuantity: true, isService: true, companyId: true },
  })
  if (!product || product.companyId !== args.companyId) {
    return { ok: false, error: "Ürün bulunamadı" }
  }
  if (product.isService) {
    return { ok: false, error: "Hizmet kaleminde stok hareketi olmaz" }
  }

  const [movement, agg] = await Promise.all([
    findOpeningMovement(db, args.companyId, args.productId),
    db.stockMovement.aggregate({
      where: { companyId: args.companyId, productId: args.productId },
      _sum: { quantity: true },
    }),
  ])

  const card = Number(product.stockQuantity)
  const plan = planOpeningStock({
    target: args.quantity,
    cardQuantity: card,
    movementSum: Number(agg._sum.quantity || 0),
    openingMovementQuantity: movement ? Number(movement.quantity) : null,
  })
  if (!plan.ok) return plan

  // Depo satırları var olsun: eski kayıtlarda bakiye yalnız kartta durabiliyor.
  await materializeLegacyStock(db, args.companyId, args.productId)

  const previousWarehouseId = movement?.warehouseId ?? null
  const warehouseId =
    args.warehouseId || previousWarehouseId || (await ensureDefaultWarehouseId(db, args.companyId))

  const moved = Boolean(previousWarehouseId) && previousWarehouseId !== warehouseId

  if (moved) {
    // Açılış başka depoya taşınıyor: eski depodan açılışın TAMAMI düşer, yenisine
    // HEDEF girer. Eski depoda o kadar mal kalmadıysa işlem yapılmaz — aradaki
    // fark satılmış ya da transfer edilmiş demektir, sessizce eksiye düşürmeyiz.
    const from = await db.warehouseStock.findUnique({
      where: {
        warehouseId_productId: { warehouseId: previousWarehouseId!, productId: args.productId },
      },
      select: { quantity: true },
    })
    if (round4(Number(from?.quantity || 0) - plan.previous) < 0) {
      return {
        ok: false,
        error: "Açılışın kayıtlı olduğu depoda bu kadar bakiye yok; önce depo transferini düzeltin.",
      }
    }
    await db.warehouseStock.update({
      where: {
        warehouseId_productId: { warehouseId: previousWarehouseId!, productId: args.productId },
      },
      data: { quantity: { decrement: plan.previous } },
    })
    await db.warehouseStock.upsert({
      where: { warehouseId_productId: { warehouseId, productId: args.productId } },
      create: { warehouseId, productId: args.productId, quantity: plan.movementQuantity },
      update: { quantity: { increment: plan.movementQuantity } },
    })
  } else if (plan.delta !== 0) {
    const row = await db.warehouseStock.findUnique({
      where: { warehouseId_productId: { warehouseId, productId: args.productId } },
      select: { quantity: true },
    })
    if (round4(Number(row?.quantity || 0) + plan.delta) < 0) {
      return {
        ok: false,
        error: "Seçili depodaki bakiye negatife düşerdi; açılışı bu kadar azaltamazsınız.",
      }
    }
    await db.warehouseStock.upsert({
      where: { warehouseId_productId: { warehouseId, productId: args.productId } },
      create: { warehouseId, productId: args.productId, quantity: plan.delta },
      update: { quantity: { increment: plan.delta } },
    })
  }

  if (movement) {
    await db.stockMovement.update({
      where: { id: movement.id },
      data: {
        quantity: plan.movementQuantity,
        warehouseId,
        ...(args.unitPrice !== undefined ? { unitPrice: args.unitPrice } : {}),
        ...(args.date ? { createdAt: args.date } : {}),
      },
    })
  } else if (plan.movementQuantity !== 0) {
    await db.stockMovement.create({
      data: {
        companyId: args.companyId,
        warehouseId,
        productId: args.productId,
        type: "IN",
        quantity: plan.movementQuantity,
        unitPrice: args.unitPrice ?? null,
        description: OPENING_STOCK_DESCRIPTION,
        createdBy: args.createdBy ?? null,
        ...(args.date ? { createdAt: args.date } : {}),
      },
    })
  }
  // Hareketi olmayan üründe açılış 0 yapıldıysa defter satırı YAZILMAZ: "0 adet
  // giriş" hiçbir şey anlatmaz. Kalıntı kartta düzeltildiği için bir sonraki
  // okumada açılış yine 0 hesaplanır (kart − Σhareket), yani bilgi kaybı yok.

  if (plan.delta !== 0) {
    await db.product.update({
      where: { id: args.productId },
      data: { stockQuantity: { increment: plan.delta } },
    })
  }

  return {
    ok: true,
    openingQuantity: plan.movementQuantity,
    stockQuantity: round4(card + plan.delta),
    delta: plan.delta,
  }
}
