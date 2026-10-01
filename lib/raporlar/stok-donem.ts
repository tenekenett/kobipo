/**
 * Stok raporunun dönem sütunları — sorgu katmanı (kural: `stok-donem-kural.ts`).
 *
 * Ekran (`/api/raporlar/stok-donem`) ve dışa aktarım (`rapor-stok`) bu
 * fonksiyonu çağırır: biri kendi hesabını yaparsa "ekranda 42 satış, Excel'de 47"
 * doğar.
 *
 * CARİ kesiti — iki yön, aynı anda yalnız biri:
 *
 *  - MÜŞTERİ (`customerId`): yalnız o müşterinin SATIŞ belgelerine (fatura,
 *    fiş, satış iadesi) bağlı hareketler ve belge kalemleri sayılır — "bu
 *    müşteri dönemde hangi üründen kaç adet aldı". Anlamlı sütun "Satılan"dır.
 *  - TEDARİKÇİ (`supplierId`): yalnız o tedarikçinin ALIŞ belgelerine (alış
 *    faturası, alış iadesi, alış İRSALİYESİ) bağlı hareketler sayılır — "bu
 *    tedarikçiden dönemde hangi üründen kaç adet aldık". Anlamlı sütun
 *    "Giriş"tir (ekranda "Alınan"). İrsaliye ŞARTTIR: irsaliyesi teslim alınmış
 *    malın stoğu irsaliyeden girer (`waybill:<id>`), bağlanan fatura stoğu
 *    ikinci kez işlemez; yalnız faturaya bakılsaydı irsaliyeli alımlar kesitten
 *    düşerdi. Hizmetin stok hareketi yoktur; alınan hizmet alış kalemlerinden
 *    sayılır (satıştaki `documentSold`un aynası).
 *
 * Kesitte cariye bağlı olmayan her şey YOKTUR (elle giriş, açılış, fire, sayım,
 * faturasız elle satış); ekran o sütunları gizler. Bu yüzden müşteri bazındaki
 * "satılan"ların toplamı firma toplamından azdır (carisiz perakende satış hiçbir
 * müşteriye düşmez); tedarikçide de elle giriş ve açılış hiçbir tedarikçiye düşmez.
 *
 * Dönem ekseni iki kaynakta farklıdır ve bilerek öyledir:
 *  - Hareket: `createdAt` — stok hareket raporuyla aynı eksen (elle fişte
 *    kullanıcının seçtiği tarih buraya yazılır).
 *  - Belgeden sayılan miktar (hizmet, reçeteli ürün): fatura `date` — satış/alış
 *    raporuyla aynı eksen.
 */

import { prisma } from "@/lib/db/prisma"
import { BadRequestError } from "@/lib/http/query-params"
import { resolvePeriodBounds, periodWhere } from "@/lib/raporlar/date-range"
import {
  isPurchaseReturn,
  isSalesReturn,
  payableSign,
  PURCHASE_RETURN_WHERE,
  receivableSign,
  SALES_RETURN_WHERE,
} from "@/lib/cari/invoice-direction"
import {
  applyDocumentInbound,
  applyDocumentSales,
  classifyStockFlows,
  type DocFamily,
  type ProductFlow,
} from "@/lib/raporlar/stok-donem-kural"

const WAYBILL_PREFIX = "waybill:"
/** `IN (...)` bind sınırına çarpmamak için referans çözümü parça parça yapılır. */
const CHUNK = 5000

/** Belgeden sayılan miktarda dışarıda kalan durumlar — kâr/zarar ile aynı kural. */
const NOT_COUNTED_STATUSES = ["CANCELLED", "CONVERTED"]

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

/**
 * Cari kesitinin hareket referansları: müşteride satış ailesi belgeleri,
 * tedarikçide alış ailesi belgeleri + alış irsaliyeleri. Belge tarihine
 * bakılmaz: hareketin dönemi `createdAt`tir (başlıktaki eksen).
 */
async function partyReferences(
  companyId: string,
  party: { customerId: string | null; supplierId: string | null },
): Promise<string[] | null> {
  if (party.customerId) {
    const docs = await prisma.invoice.findMany({
      where: { companyId, customerId: party.customerId, OR: [{ type: "SALES" }, SALES_RETURN_WHERE()] },
      select: { id: true },
    })
    return docs.map((d) => d.id)
  }
  if (party.supplierId) {
    const [docs, waybills] = await Promise.all([
      prisma.invoice.findMany({
        where: {
          companyId,
          supplierId: party.supplierId,
          OR: [{ type: "PURCHASE" }, PURCHASE_RETURN_WHERE()],
        },
        select: { id: true },
      }),
      prisma.waybill.findMany({
        where: { companyId, supplierId: party.supplierId, type: "PURCHASE" },
        select: { id: true },
      }),
    ])
    return [...docs.map((d) => d.id), ...waybills.map((w) => `${WAYBILL_PREFIX}${w.id}`)]
  }
  return null
}

export async function computeStockPeriodFlows(args: {
  companyId: string
  startDate?: string | null
  endDate?: string | null
  /** Yalnız bu müşterinin satış belgeleri (bkz. başlık). */
  customerId?: string | null
  /** Yalnız bu tedarikçinin alış belgeleri ve irsaliyeleri (bkz. başlık). */
  supplierId?: string | null
}): Promise<StockPeriodFlows> {
  const { companyId } = args
  const customerId = args.customerId || null
  const supplierId = args.supplierId || null
  // İki kesit birlikte anlamsız: biri "Satılan"ı, öteki "Giriş"i taşır. Sessizce
  // birini seçmek ekranla dosyayı ayrıştırırdı — uç da dışa aktarım da 400 döner.
  if (customerId && supplierId) {
    throw new BadRequestError("Müşteri ve tedarikçi süzgeci birlikte kullanılamaz.")
  }
  const bounds = resolvePeriodBounds(args.startDate, args.endDate)

  const partyRefs = await partyReferences(companyId, { customerId, supplierId })

  const movementSelect = {
    productId: true,
    type: true,
    quantity: true,
    reason: true,
    reference: true,
    description: true,
  } as const
  const loadMovements = async () => {
    const where = { companyId, createdAt: periodWhere(bounds) }
    if (!partyRefs) return prisma.stockMovement.findMany({ where, select: movementSelect })
    const parts = []
    for (let i = 0; i < partyRefs.length; i += CHUNK) {
      parts.push(
        ...(await prisma.stockMovement.findMany({
          where: { ...where, reference: { in: partyRefs.slice(i, i + CHUNK) } },
          select: movementSelect,
        })),
      )
    }
    return parts
  }

  const [movements, documentProducts] = await Promise.all([
    loadMovements(),
    // Kendi stok hareketi olmayan ürünler: hizmet + aktif reçeteli.
    prisma.product.findMany({
      where: { companyId, OR: [{ isService: true }, { recipe: { is: { isActive: true } } }] },
      select: { id: true, isService: true },
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

  if (supplierId) {
    // Tedarikçi kesiti: satış yok; alınan HİZMET alış kalemlerinden.
    const serviceIds = new Set(documentProducts.filter((p) => p.isService).map((p) => p.id))
    const documentInbound = new Map<string, number>()
    if (serviceIds.size > 0) {
      const items = await prisma.invoiceItem.findMany({
        where: {
          productId: { in: Array.from(serviceIds) },
          invoice: {
            companyId,
            supplierId,
            date: periodWhere(bounds),
            status: { notIn: NOT_COUNTED_STATUSES },
            OR: [{ type: "PURCHASE" }, PURCHASE_RETURN_WHERE()],
          },
        },
        select: { productId: true, quantity: true, invoice: { select: { type: true, returnKind: true } } },
      })
      for (const item of items) {
        if (!item.productId) continue
        const qty = payableSign(item.invoice) * Number(item.quantity || 0)
        documentInbound.set(item.productId, (documentInbound.get(item.productId) ?? 0) + qty)
      }
    }
    applyDocumentInbound(byProduct, serviceIds, documentInbound)
    return { start: bounds.start, endExclusive: bounds.endExclusive, byProduct }
  }

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
          ...(customerId ? { customerId } : {}),
          date: periodWhere(bounds),
          status: { notIn: NOT_COUNTED_STATUSES },
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
