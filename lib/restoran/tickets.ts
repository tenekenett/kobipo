// Adisyon (masa hesabı) ortak sunucu yardımcıları — Aşama 2.
// Kararlar: docs/restoran/ASAMA2.md
//
// Adisyon RESMÎ BELGE DEĞİLDİR: saatlerce açık kalan bir çalışma kaydıdır ve
// stoğa/cariye dokunmaz. Muhasebe etkisi yalnızca KAPANIŞTA doğar — o an v1'in
// fiş yolu (`isReceipt: true`) çalışır, stok reçeteyle genişletilip düşülür.
// Bu yüzden burada stok/maliyet hesabı YOKTUR; olması da istenmez.

import { prisma } from "@/lib/db/prisma"
import { Prisma } from "@prisma/client"

/** Adisyon kalemi fiyatları NET (KDV hariç) tutulur — fatura API'si net bekler. */
export const TICKET_STATUSES = ["OPEN", "CLOSED", "CANCELLED"] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]

export const TABLE_SHAPES = ["SQUARE", "CIRCLE", "RECT"] as const

/**
 * Dükkan krokisi öğeleri. Masa DEĞİLLER: adisyon açılmaz, doluluk sayılmaz —
 * salonun neye benzediğini anlatırlar (bkz. ASAMA2.md "Dükkan krokisi").
 */
export const PLAN_ITEM_KINDS = [
  "WALL", // duvar / bölme
  "DOOR", // kapı / giriş
  "BAR", // bar, tezgâh, kasa
  "KITCHEN", // mutfak
  "WC", // tuvalet
  "STAIRS", // merdiven
  "PLANT", // bitki / dekor
  "TEXT", // serbest yazı ("Sigara içilir", "Teras")
] as const

export type PlanItemKind = (typeof PLAN_ITEM_KINDS)[number]

/** Öğe eklenirken kullanılan varsayılan ölçüler (ızgara hücresi). */
export function planItemDefaults(kind: string): { width: number; height: number } {
  switch (kind) {
    case "WALL":
      return { width: 8, height: 1 }
    case "DOOR":
      return { width: 2, height: 1 }
    case "BAR":
      return { width: 6, height: 2 }
    case "KITCHEN":
      return { width: 5, height: 4 }
    case "WC":
      return { width: 3, height: 3 }
    case "STAIRS":
      return { width: 2, height: 4 }
    case "PLANT":
      return { width: 1, height: 1 }
    default:
      return { width: 4, height: 1 }
  }
}

/**
 * Modül kapısı (sunucu tarafı). `restaurant` kapalı bir firmada bu uçlar
 * çağrılamaz. `ensureCompanyAccess` zaten `disabledModules`'ü döndürdüğü için
 * ek sorgu maliyeti yok.
 *
 * Hata metni "Access denied" ile başlar: mevcut route `catch`'leri bu ifadeyi
 * 403'e mapliyor, kapı catch'i olmayan uçta da fail-closed kalıyor.
 *
 * NOT: v1'in dört rapor ucu ve reçete ucu HENÜZ bu kapıdan geçmiyor
 * (bkz. SADELESTIRME.md "Sırada ne var"). Aşama 2 uçları baştan geçiyor —
 * kapıyı sonradan eklemek, açık kalan uçları tek tek aramak demek.
 */
export function assertRestaurantModule(context: { disabledModules?: string[] }): void {
  if ((context.disabledModules ?? []).includes("restaurant")) {
    throw new Error("Access denied: Restoran & Kafe modülü kapalı")
  }
}

/**
 * Firma bazlı adisyon numarası: `ADS-YYYY-NNNN`.
 *
 * Fatura numarasından AYRI bir dizi (adisyon fişe dönüşünce fiş kendi numarasını
 * alır). `generateInvoiceNumber` ile aynı "en büyüğü bul, boş olana kadar ilerle"
 * yaklaşımı: sayma tabanlı üretim, silinen kayıtların açtığı boşluklarda var olan
 * bir numarayla çakışıyordu.
 */
export async function nextTicketCode(
  db: Pick<typeof prisma, "restaurantTicket">,
  companyId: string,
  date = new Date(),
): Promise<string> {
  const fullPrefix = `ADS-${date.getFullYear()}-`
  const existing = await db.restaurantTicket.findMany({
    where: { companyId, code: { startsWith: fullPrefix } },
    select: { code: true },
  })

  let maxSeq = 0
  const taken = new Set<string>()
  for (const { code } of existing) {
    taken.add(code)
    const parsed = parseInt(code.slice(fullPrefix.length), 10)
    if (Number.isFinite(parsed) && parsed > maxSeq) maxSeq = parsed
  }

  let seq = maxSeq + 1
  let candidate = `${fullPrefix}${String(seq).padStart(4, "0")}`
  while (taken.has(candidate)) {
    seq += 1
    candidate = `${fullPrefix}${String(seq).padStart(4, "0")}`
  }
  return candidate
}

// `Prisma.validator` ile: `as const` readonly dizi üretiyor ve Prisma'nın
// mutable `orderBy` tipine oturmuyordu.
export const ticketInclude = Prisma.validator<Prisma.RestaurantTicketInclude>()({
  items: { orderBy: [{ order: "asc" }, { createdAt: "asc" }] },
  table: { select: { id: true, name: true, areaId: true } },
  customer: { select: { id: true, name: true } },
  invoice: { select: { id: true, invoiceNo: true, status: true } },
})

type TicketWithRelations = Prisma.RestaurantTicketGetPayload<{ include: typeof ticketInclude }>

export type TicketTotals = { net: number; vat: number; total: number }

/**
 * Adisyon toplamı. Kalem `unitPrice`'ı NET olduğu için KDV burada eklenir —
 * ekranda gösterilen tutar brüttür (kahveci ekranındaki `grossPrice` ile aynı
 * kural). Fişin kesin toplamı yine SUNUCUDA fatura ucunda hesaplanır; bu değer
 * ekranda gösterim ve kapanış öncesi kontrol içindir.
 */
export function ticketTotals(
  items: Array<{ quantity: unknown; unitPrice: unknown; vatRate: unknown }>,
): TicketTotals {
  let net = 0
  let vat = 0
  for (const item of items) {
    const lineNet = Number(item.quantity) * Number(item.unitPrice)
    net += lineNet
    vat += lineNet * (Number(item.vatRate) / 100)
  }
  const round2 = (v: number) => Math.round(v * 100) / 100
  return { net: round2(net), vat: round2(vat), total: round2(net + vat) }
}

/** Decimal alanları sayıya çevirir; istemci string ile uğraşmasın. */
export function serializeTicket(ticket: TicketWithRelations) {
  const items = ticket.items.map((item) => ({
    id: item.id,
    productId: item.productId,
    description: item.description,
    unit: item.unit,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice),
    vatRate: Number(item.vatRate),
    note: item.note,
    order: item.order,
    createdAt: item.createdAt,
  }))

  return {
    id: ticket.id,
    code: ticket.code,
    status: ticket.status,
    tableId: ticket.tableId,
    tableName: ticket.table?.name ?? null,
    areaId: ticket.table?.areaId ?? null,
    customerId: ticket.customerId,
    customerName: ticket.customer?.name ?? null,
    guestCount: ticket.guestCount,
    note: ticket.note,
    openedAt: ticket.openedAt,
    closedAt: ticket.closedAt,
    invoiceId: ticket.invoiceId,
    invoiceNo: ticket.invoice?.invoiceNo ?? null,
    items,
    totals: ticketTotals(items),
  }
}
