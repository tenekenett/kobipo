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
export async function revertInvoiceStock(
  db: Db,
  args: {
    companyId: string
    invoiceId: string
    invoiceNo?: string | null
    createdBy?: string | null
  },
): Promise<void> {
  const grouped = await db.stockMovement.groupBy({
    by: ["productId", "warehouseId"],
    where: { companyId: args.companyId, reference: args.invoiceId },
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
      description: `${args.invoiceNo || args.invoiceId} - Fatura iptali (stok iade)`,
      reference: args.invoiceId,
      createdBy: args.createdBy ?? null,
    })
  }
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
