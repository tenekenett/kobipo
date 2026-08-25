import { prisma } from "@/lib/db/prisma"

// PrismaClient veya $transaction içindeki client — ikisi de model metodlarını taşır.
type Db = Pick<typeof prisma, "warehouse" | "warehouseStock" | "product" | "stockMovement">

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
