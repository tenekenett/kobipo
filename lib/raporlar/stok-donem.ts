/**
 * Stok raporunun dönem sütunları — sorgu katmanı (kural: `stok-donem-kural.ts`).
 *
 * Ekran (`/api/raporlar/stok-donem`) ve dışa aktarım (`rapor-stok`) bu
 * fonksiyonu çağırır: biri kendi hesabını yaparsa "ekranda 42 satış, Excel'de 47"
 * doğar.
 *
 * Dönem ekseni iki kaynakta farklıdır ve bilerek öyledir:
 *  - Hareket: `createdAt` — stok hareket raporuyla aynı eksen (elle fişte
 *    kullanıcının seçtiği tarih buraya yazılır).
 *  - Belgeden sayılan satış (hizmet, reçeteli ürün): fatura `date` — satış
 *    raporuyla aynı eksen.
 */

import { prisma } from "@/lib/db/prisma"
import { resolvePeriodBounds, periodWhere } from "@/lib/raporlar/date-range"
import { isPurchaseReturn, isSalesReturn, receivableSign, SALES_RETURN_WHERE } from "@/lib/cari/invoice-direction"
import {
  applyDocumentSales,
  classifyStockFlows,
  type DocFamily,
  type ProductFlow,
} from "@/lib/raporlar/stok-donem-kural"

const WAYBILL_PREFIX = "waybill:"
/** `IN (...)` bind sınırına çarpmamak için referans çözümü parça parça yapılır. */
const CHUNK = 5000

export type StockPeriodFlows = {
  start: Date
  /** Dışlayıcı bitiş. */
  endExclusive: Date
  byProduct: Map<string, ProductFlow>
}

function docFamily(inv: { type: string; returnKind: string | null }): DocFamily {
  const t = String(inv.type || "").toUpperCase()
  if (t === "SALES" || isSalesReturn(inv)) return "SALES"
  if (t === "PURCHASE" || isPurchaseReturn(inv)) return "PURCHASE"
  return "UNKNOWN"
}

export async function computeStockPeriodFlows(args: {
  companyId: string
  startDate?: string | null
  endDate?: string | null
}): Promise<StockPeriodFlows> {
  const { companyId } = args
  const bounds = resolvePeriodBounds(args.startDate, args.endDate)

  const [movements, documentProducts] = await Promise.all([
    prisma.stockMovement.findMany({
      where: { companyId, createdAt: periodWhere(bounds) },
      select: { productId: true, type: true, quantity: true, reason: true, reference: true, description: true },
    }),
    // Kendi stok hareketi olmayan ürünler: hizmet + aktif reçeteli.
    prisma.product.findMany({
      where: { companyId, OR: [{ isService: true }, { recipe: { is: { isActive: true } } }] },
      select: { id: true },
    }),
  ])

  // Referansların belge ailesi. İrsaliye önekiyle gelir; kalanlar fatura/fiş id'si.
  const invoiceRefs = Array.from(
    new Set(
      movements
        .map((m) => m.reference)
        .filter((r): r is string => !!r && !r.startsWith(WAYBILL_PREFIX)),
    ),
  )
  const families = new Map<string, DocFamily>()
  for (let i = 0; i < invoiceRefs.length; i += CHUNK) {
    const rows = await prisma.invoice.findMany({
      where: { companyId, id: { in: invoiceRefs.slice(i, i + CHUNK) } },
      select: { id: true, type: true, returnKind: true },
    })
    for (const row of rows) families.set(row.id, docFamily(row))
  }
  const familyOf = (reference: string): DocFamily =>
    reference.startsWith(WAYBILL_PREFIX) ? "WAYBILL" : (families.get(reference) ?? "UNKNOWN")

  const byProduct = classifyStockFlows(
    movements.map((m) => ({ ...m, quantity: Number(m.quantity) })),
    familyOf,
  )

  // Belgeden sayılan satış — kâr/zarar ile aynı kural: iptal ve faturaya
  // dönüşmüş fiş hariç (dönüşen fişin kalemleri birleşik faturada sayılır).
  const documentProductIds = new Set(documentProducts.map((p) => p.id))
  const documentSold = new Map<string, number>()
  if (documentProductIds.size > 0) {
    const items = await prisma.invoiceItem.findMany({
      where: {
        productId: { in: Array.from(documentProductIds) },
        invoice: {
          companyId,
          date: periodWhere(bounds),
          status: { notIn: ["CANCELLED", "CONVERTED"] },
          OR: [{ type: "SALES" }, SALES_RETURN_WHERE()],
        },
      },
      select: { productId: true, quantity: true, invoice: { select: { type: true, returnKind: true } } },
    })
    for (const item of items) {
      if (!item.productId) continue
      const qty = receivableSign(item.invoice) * Number(item.quantity || 0)
      documentSold.set(item.productId, (documentSold.get(item.productId) ?? 0) + qty)
    }
  }
  applyDocumentSales(byProduct, documentProductIds, documentSold)

  return { start: bounds.start, endExclusive: bounds.endExclusive, byProduct }
}
