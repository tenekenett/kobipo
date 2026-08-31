/**
 * Stok hareket raporu — ekran ve dışa aktarma için TEK hesap.
 *
 * Stok hareketinin üzerinde cari yoktur; yalnız KAYNAK BELGE referansı vardır
 * (`StockMovement.reference`): fatura id'si, `waybill:<id>` (irsaliye) veya
 * adisyon id'si. Müşteri/tedarikçi ve "tanım" (cari sınıflandırması) süzgeçleri
 * bu yüzden önce belgeye, oradan cariye gider. Belgesiz hareketler (sayım,
 * transfer, açılış stoğu, ikram) cari süzgeci seçildiğinde listeye giremez —
 * bağlanacakları bir cari yoktur.
 */

import { prisma } from "@/lib/db/prisma"
import {
  isInboundMovement,
  movementTypeLabel,
  signedMovementQuantity,
} from "@/lib/stock/movement-sign"

/** İrsaliye referansı bu önekle yazılır (bkz. app/api/irsaliye/[id]/route.ts). */
const WAYBILL_PREFIX = "waybill:"

/** Ekranın bir seferde çekeceği satır tavanı; dosyada da aynı tavan geçerli. */
const DEFAULT_LIMIT = 1000

export type StockMovementFilters = {
  companyId: string
  startDate?: string | null
  endDate?: string | null
  customerId?: string | null
  supplierId?: string | null
  /** Cari kartındaki sınıflandırmalar (Ayarlar → Tanımlar). */
  class1Id?: string | null
  class2Id?: string | null
  productId?: string | null
  /** Ürün adı/kodu/barkodu içinde arar. */
  search?: string | null
  limit?: number
}

export type StockMovementReportRow = {
  id: string
  date: string
  type: string
  typeLabel: string
  productId: string
  productCode: string
  productName: string
  unit: string
  warehouseName: string
  /** İşaretli miktar: + giriş, − çıkış. */
  quantity: number
  unitPrice: number
  totalAmount: number
  description: string
  /** Kaynak belge — yoksa hepsi boş gelir. */
  documentKind: "INVOICE" | "WAYBILL" | null
  documentId: string | null
  documentNo: string
  counterpartyKind: "customer" | "supplier" | null
  counterpartyId: string | null
  counterpartyName: string
  class1: string
  class2: string
}

export type StockMovementReport = {
  rows: StockMovementReportRow[]
  totals: { count: number; totalIn: number; totalOut: number; net: number }
  /** Tavana dayanıldı mı — ekran "daha fazlası var" diyebilsin. */
  truncated: boolean
}

type PartyRef = {
  kind: "customer" | "supplier"
  id: string
  name: string
  class1: string
  class2: string
}

const PARTY_SELECT = {
  select: {
    id: true,
    name: true,
    classification1: { select: { label: true } },
    classification2: { select: { label: true } },
  },
} as const

type PartyRow = {
  id: string
  name: string
  classification1: { label: string } | null
  classification2: { label: string } | null
} | null

function toPartyRef(kind: "customer" | "supplier", party: PartyRow): PartyRef | null {
  if (!party) return null
  return {
    kind,
    id: party.id,
    name: party.name,
    class1: party.classification1?.label || "",
    class2: party.classification2?.label || "",
  }
}

/**
 * Cari süzgeçlerinin BELGE tarafındaki karşılığı. Her süzgeç ayrı bir koşuldur
 * (AND); her biri kendi içinde müşteri VEYA tedarikçi tarafına bakar — aynı
 * ekran hem alış hem satış hareketlerini listeliyor.
 */
function documentPartyConditions(filters: StockMovementFilters): any[] {
  const conditions: any[] = []
  if (filters.customerId) conditions.push({ customerId: filters.customerId })
  if (filters.supplierId) conditions.push({ supplierId: filters.supplierId })
  if (filters.class1Id) {
    conditions.push({
      OR: [
        { customer: { classification1Id: filters.class1Id } },
        { supplier: { classification1Id: filters.class1Id } },
      ],
    })
  }
  if (filters.class2Id) {
    conditions.push({
      OR: [
        { customer: { classification2Id: filters.class2Id } },
        { supplier: { classification2Id: filters.class2Id } },
      ],
    })
  }
  return conditions
}

export async function computeStockMovementReport(
  filters: StockMovementFilters
): Promise<StockMovementReport> {
  const { companyId } = filters
  const limit = filters.limit && filters.limit > 0 ? filters.limit : DEFAULT_LIMIT

  const dateFilter =
    filters.startDate || filters.endDate
      ? {
          gte: filters.startDate ? new Date(filters.startDate) : undefined,
          // Bitiş günü DAHİL: kullanıcı gün seçiyor, hareketin saati var.
          lte: filters.endDate ? new Date(`${filters.endDate}T23:59:59.999`) : undefined,
        }
      : undefined

  // Cari süzgeci varsa hareketler DB tarafında referansla daraltılır: eşleşen
  // belgelerin id'leri önce bulunur. Bellekte süzmek, tavana takılan sayfada
  // yanlış (eksik) sonuç verirdi.
  const partyConditions = documentPartyConditions(filters)
  let referenceFilter: string[] | null = null
  if (partyConditions.length > 0) {
    const [invoices, waybills] = await Promise.all([
      prisma.invoice.findMany({
        where: { companyId, AND: partyConditions },
        select: { id: true },
      }),
      prisma.waybill.findMany({
        where: { companyId, AND: partyConditions },
        select: { id: true },
      }),
    ])
    referenceFilter = [
      ...invoices.map((i) => i.id),
      ...waybills.map((w) => `${WAYBILL_PREFIX}${w.id}`),
    ]
  }

  const search = filters.search?.trim()
  const movements = await prisma.stockMovement.findMany({
    where: {
      companyId,
      ...(dateFilter ? { createdAt: dateFilter } : {}),
      ...(filters.productId ? { productId: filters.productId } : {}),
      ...(referenceFilter ? { reference: { in: referenceFilter } } : {}),
      ...(search
        ? {
            product: {
              OR: [
                { name: { contains: search, mode: "insensitive" as const } },
                { code: { contains: search, mode: "insensitive" as const } },
                { barcode: { contains: search, mode: "insensitive" as const } },
              ],
            },
          }
        : {}),
    },
    include: {
      product: { select: { id: true, code: true, name: true, unit: true, purchasePrice: true, salePrice: true } },
      warehouse: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  })

  const truncated = movements.length > limit
  const page = truncated ? movements.slice(0, limit) : movements

  // Belge çözümü: listelenen satırların referansları toplanır, fatura ve
  // irsaliye ayrı ayrı okunur.
  const invoiceIds = new Set<string>()
  const waybillIds = new Set<string>()
  for (const movement of page) {
    const reference = movement.reference
    if (!reference) continue
    if (reference.startsWith(WAYBILL_PREFIX)) waybillIds.add(reference.slice(WAYBILL_PREFIX.length))
    else invoiceIds.add(reference)
  }

  const [invoices, waybills] = await Promise.all([
    invoiceIds.size > 0
      ? prisma.invoice.findMany({
          where: { id: { in: Array.from(invoiceIds) }, companyId },
          select: {
            id: true,
            invoiceNo: true,
            eDocumentNo: true,
            customer: PARTY_SELECT,
            supplier: PARTY_SELECT,
          },
        })
      : Promise.resolve([]),
    waybillIds.size > 0
      ? prisma.waybill.findMany({
          where: { id: { in: Array.from(waybillIds) }, companyId },
          select: {
            id: true,
            waybillNo: true,
            customer: PARTY_SELECT,
            supplier: PARTY_SELECT,
          },
        })
      : Promise.resolve([]),
  ])

  type DocumentInfo = {
    kind: "INVOICE" | "WAYBILL"
    id: string
    no: string
    party: PartyRef | null
  }
  const documents = new Map<string, DocumentInfo>()
  for (const invoice of invoices) {
    documents.set(invoice.id, {
      kind: "INVOICE",
      id: invoice.id,
      // Belge numarası olarak e-Belge numarası tercih edilir (GİB'e giden asıl
      // numara); yoksa iç fatura numarasına düşülür.
      no: invoice.eDocumentNo || invoice.invoiceNo,
      party:
        toPartyRef("customer", invoice.customer) ?? toPartyRef("supplier", invoice.supplier),
    })
  }
  for (const waybill of waybills) {
    documents.set(`${WAYBILL_PREFIX}${waybill.id}`, {
      kind: "WAYBILL",
      id: waybill.id,
      no: waybill.waybillNo,
      party:
        toPartyRef("customer", waybill.customer) ?? toPartyRef("supplier", waybill.supplier),
    })
  }

  let totalIn = 0
  let totalOut = 0

  const rows: StockMovementReportRow[] = page.map((movement) => {
    const quantity = signedMovementQuantity(movement)
    if (quantity > 0) totalIn += quantity
    else totalOut += -quantity

    // Eski kayıtlarda birim fiyat null olabilir; ürün kartındaki alış/satış
    // fiyatına düşülür (ürün kartı hareket listesiyle aynı kural).
    const unitPrice =
      movement.unitPrice != null
        ? Number(movement.unitPrice)
        : Number(
            (isInboundMovement(movement)
              ? movement.product?.purchasePrice
              : movement.product?.salePrice) || 0
          )

    const document = movement.reference ? documents.get(movement.reference) : undefined

    return {
      id: movement.id,
      date: movement.createdAt.toISOString(),
      type: movement.type,
      typeLabel: movementTypeLabel(movement),
      productId: movement.productId,
      productCode: movement.product?.code || "",
      productName: movement.product?.name || "",
      unit: movement.product?.unit || "",
      warehouseName: movement.warehouse?.name || "",
      quantity,
      unitPrice,
      totalAmount: Math.abs(quantity) * unitPrice,
      description: movement.description || "",
      documentKind: document?.kind ?? null,
      documentId: document?.id ?? null,
      documentNo: document?.no ?? "",
      counterpartyKind: document?.party?.kind ?? null,
      counterpartyId: document?.party?.id ?? null,
      counterpartyName: document?.party?.name ?? "",
      class1: document?.party?.class1 ?? "",
      class2: document?.party?.class2 ?? "",
    }
  })

  return {
    rows,
    totals: {
      count: rows.length,
      totalIn: Math.round(totalIn * 10000) / 10000,
      totalOut: Math.round(totalOut * 10000) / 10000,
      net: Math.round((totalIn - totalOut) * 10000) / 10000,
    },
    truncated,
  }
}
