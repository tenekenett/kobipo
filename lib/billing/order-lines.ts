// `PackageOrder.priceLines` JSON kolonunu YAZAN ve OKUYAN tek yer.
//
// Kolon, siparişin tutarını kalem kalem açar (paket, her ek modül, ek şube, ek firma).
// Tutarın kendisi gibi bir SNAPSHOT'tır: katalog fiyatı sonradan değiştiğinde geriye
// dönük yeniden hesap bugünün fiyatını verir, müşterinin ödediğini değil.
//
// Şema `Json?` olduğu için okurken gövdeye güvenilmez: eski kayıtlar null, elle
// düzeltilmiş kayıtlar bozuk olabilir. `parsePriceLines` şekli tutmayan her şeyi eler —
// arayüz "döküm yok" der, yarım bir tabloyu doğruymuş gibi basmaz.

import { prisma } from "@/lib/db/prisma"
import type { Prisma } from "@prisma/client"
import type { OrderLine } from "@/lib/billing/pricing"
import { BRANCH_ITEM_KEY, COMPANY_ITEM_KEY, modulePriceKey } from "@/lib/billing/constants"
import { moduleLabel } from "@/lib/modules"

export type { OrderLine }

/** Fiyatı bilinmeyen kalem: NE alındığı, kaça alındığı değil. */
export type ContentLine = { key: string; label: string; qty: number }

/**
 * Siparişin İÇERİĞİNİ kendi snapshot alanlarından türetir.
 *
 * Ayrım şu: "ne alındı" her siparişte kayıtlı (`planName`, `selectedModules`,
 * `branchQuota`, `companyQuota`), "kaça alındı" ise yalnız `priceLines` yazıldıysa.
 * Dökümü olmayan eski siparişlerde ekran en azından "3 şube kotası" diyebilsin diye
 * içerik ayrı türetilir — birim fiyat sütunu boş kalır, uydurulmaz.
 */
export function deriveContentLines(order: {
  planName: string | null
  selectedModules: string[]
  resolvedModules: string[]
  branchQuota: number
  companyQuota: number
}): ContentLine[] {
  const lines: ContentLine[] = []
  if (order.planName) {
    lines.push({ key: "plan", label: order.planName, qty: 1 })
  }
  // `selectedModules` = paket dışı ÜCRETLENDİRİLEN ekstralar; asıl aranan bu. Boşsa
  // (yenileme ve elle tahsilat siparişleri onu doldurmuyor) açılan kümeye düşülür.
  const modules = order.selectedModules.length ? order.selectedModules : order.resolvedModules
  for (const m of modules) {
    lines.push({ key: modulePriceKey(m), label: `Modül: ${moduleLabel(m)}`, qty: 1 })
  }
  // KOTA SATIRLARI TOPLAMDIR, satın alınan EK adet değil: `PackageOrder.branchQuota`
  // siparişin sonunda geçerli olacak toplam kotayı tutar ve paket 3 şube içeriyorsa o
  // 3 de içindedir. "Ek Şube × 4" yazmak, 1 ek şube için ödeme yapmış müşteriye 4 tane
  // satılmış gibi görünüyordu. Ücretlendirilen ek adet yalnız `priceLines`ta durur
  // (yukarıdaki tablo); burası "sipariş sonunda kotan ne oldu" sorusunu yanıtlar.
  if (order.branchQuota > 0) {
    lines.push({ key: BRANCH_ITEM_KEY, label: "Şube kotası (toplam)", qty: order.branchQuota })
  }
  if (order.companyQuota > 0) {
    lines.push({ key: COMPANY_ITEM_KEY, label: "Ek firma kotası (toplam)", qty: order.companyQuota })
  }
  return lines
}

/**
 * Kalemleri Prisma'nın Json girdi tipine çevirir.
 *
 * `OrderLine` bir interface; TypeScript interface'lere örtük indeks imzası vermediği
 * için `InputJsonValue`a doğrudan atanamaz. Düz nesneye kopyalamak bunu çözer ve
 * kolona neyin yazıldığını da tek yerde sabitler.
 */
export function toJsonPriceLines(lines: OrderLine[]): Prisma.InputJsonValue {
  return lines.map((l) => ({
    key: l.key,
    label: l.label,
    qty: l.qty,
    unitPrice: l.unitPrice,
    total: l.total,
  }))
}

function round2(n: number): number {
  return Number(n.toFixed(2))
}

/** Kalem toplamı. Sağlıklı bir dökümde `amount + discountAmount`a eşittir. */
export function priceLinesTotal(lines: OrderLine[]): number {
  return round2(lines.reduce((sum, l) => sum + l.total, 0))
}

/** JSON kolonunu OrderLine[]'a çevirir; şekli tutmayan kayıtta null döner. */
export function parsePriceLines(value: unknown): OrderLine[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const lines: OrderLine[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null
    const l = raw as Record<string, unknown>
    const qty = Number(l.qty)
    const unitPrice = Number(l.unitPrice)
    const total = Number(l.total)
    if (typeof l.key !== "string" || typeof l.label !== "string") return null
    if (!Number.isFinite(qty) || !Number.isFinite(unitPrice) || !Number.isFinite(total)) return null
    lines.push({ key: l.key, label: l.label, qty, unitPrice, total })
  }
  return lines
}

/**
 * Yenileme siparişi için önceki siparişin dökümünü devralır.
 *
 * Yenilemede seçim yeniden yapılmaz: saklı karttan `Subscription.amount` çekilir, yani
 * müşteri geçen dönem ne aldıysa aynısını alır. Dökümü yeniden hesaplamak katalogdaki
 * GÜNCEL fiyatı yazardı; doğru kaynak, o tutarı doğuran sipariştir.
 *
 * Devralma yalnız kalem toplamı çekilen tutara EŞİTSE yapılır. Eşit değilse (araya
 * yalnız ilk döneme geçerli bir indirim girmiş ya da abonelik elle değiştirilmiş
 * olabilir) döküm yazılmaz: toplamı tutmayan bir kalem listesi, hiç döküm olmamasından
 * daha yanıltıcıdır.
 */
export async function inheritPriceLines(params: {
  companyId: string
  billingCycle: string
  /** Yenilemede tahsil edilen tutar. */
  amount: number
}): Promise<OrderLine[] | null> {
  // Son birkaç sipariş taranır, yalnız sonuncusu değil: aradaki yenilemelerin dökümü
  // (bu kural gereği) boş kalmış olabilir, asıl satın alma daha geride durur.
  const previous = await prisma.packageOrder.findMany({
    where: {
      companyId: params.companyId,
      status: "ACTIVE",
      billingCycle: params.billingCycle,
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { priceLines: true },
  })

  for (const order of previous) {
    const lines = parsePriceLines(order.priceLines)
    if (lines && priceLinesTotal(lines) === round2(params.amount)) return lines
  }
  return null
}
