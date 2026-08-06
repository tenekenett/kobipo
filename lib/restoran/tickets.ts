// Adisyon (masa hesabı) ortak sunucu yardımcıları — Aşama 2.
// Kararlar: docs/restoran/ASAMA2.md
//
// Adisyon RESMÎ BELGE DEĞİLDİR: saatlerce açık kalan bir çalışma kaydıdır ve
// stoğa/cariye dokunmaz. Muhasebe etkisi yalnızca KAPANIŞTA doğar — o an v1'in
// fiş yolu (`isReceipt: true`) çalışır, stok reçeteyle genişletilip düşülür.
// Bu yüzden burada stok/maliyet hesabı YOKTUR; olması da istenmez.

import { prisma } from "@/lib/db/prisma"
import { Prisma } from "@prisma/client"

// Saf sabitler/hesaplar ayrı dosyada (istemci de kullanıyor); sunucu tarafı
// eskiden olduğu gibi hepsini bu dosyadan görmeye devam eder.
export * from "./ticket-constants"
import {
  cancelReasonLabel,
  discountReasonLabel,
  parseItemOptions,
  reasonLabel,
  ticketDiscountOf,
  ticketTotals,
  type TicketItemStatus,
} from "./ticket-constants"

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
  // Adı KOPYALANMAZ, ilişkiden okunur: iskonto personeli açık adisyonda
  // değiştirilebilen bir SEÇİM, kalem fiyatı gibi donmuş bir kopya değil.
  discountEmployee: { select: { id: true, firstName: true, lastName: true } },
})

type TicketWithRelations = Prisma.RestaurantTicketGetPayload<{ include: typeof ticketInclude }>

export function serializeTicket(ticket: TicketWithRelations) {
  const items = ticket.items.map((item) => {
    const status = (item.status ?? "NORMAL") as TicketItemStatus
    return {
      id: item.id,
      productId: item.productId,
      description: item.description,
      unit: item.unit,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      vatRate: Number(item.vatRate),
      note: item.note,
      status,
      reasonCode: item.reasonCode,
      reason: item.reason,
      reasonLabel: reasonLabel(status, item.reasonCode),
      options: parseItemOptions(item.options),
      order: item.order,
      createdAt: item.createdAt,
    }
  })
  const discount = ticketDiscountOf(ticket)

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
    billRequestedAt: ticket.billRequestedAt,
    closedAt: ticket.closedAt,
    invoiceId: ticket.invoiceId,
    invoiceNo: ticket.invoice?.invoiceNo ?? null,
    // İptal edildiyse NEDEN — ve iptal mi gerçekten? Birleştirilen adisyon da
    // `CANCELLED` görünür ama cirosu kaybolmadı, hedefe geçti.
    mergedIntoId: ticket.mergedIntoId,
    cancelReasonCode: ticket.cancelReasonCode,
    cancelReason: ticket.cancelReason,
    cancelReasonLabel: cancelReasonLabel(ticket.cancelReasonCode),
    discountType: discount?.type ?? null,
    discountValue: discount?.value ?? null,
    discountReasonCode: ticket.discountReasonCode,
    discountReason: ticket.discountReason,
    discountReasonLabel: discountReasonLabel(ticket.discountReasonCode),
    // İskontoyu uygulayan personel (İK kartı) — ekranda iskonto satırının
    // altında, fişte iskonto etiketinde görünür.
    discountEmployeeId: ticket.discountEmployeeId,
    discountEmployeeName: ticket.discountEmployee
      ? `${ticket.discountEmployee.firstName} ${ticket.discountEmployee.lastName}`.trim()
      : null,
    discountAt: ticket.discountAt,
    items,
    totals: ticketTotals(items, discount),
  }
}
