/**
 * Stok raporunun DÖNEM hareketleri — saf kural (sorgu: `stok-donem.ts`).
 *
 * Her ürün için seçilen dönemde:
 *
 *   Giriş          alış faturası/irsaliyesi, elle giriş, açılış stoğu
 *   Satış          satış belgesine (fatura, fiş, adisyon fişi) bağlı çıkış −
 *                  satış iadesi + nedeni "Satış" seçilmiş elle çıkış
 *   Reçete         reçeteli ürün satılınca BİLEŞENDEN düşen miktar
 *   Diğer          fire, zayi, ikram, numune, sayım farkı… (İŞARETLİ)
 *
 * Değişmez: dönemdeki stok değişimi = Giriş − Satış − Reçete + Diğer
 * (transfer depolar arasıdır, ürün toplamını değiştirmez; hiçbir sütuna girmez).
 *
 * Neden faturadan değil hareketten: stok faturasız da hareket eder (elle giriş,
 * açılış, faturasız satış). Faturadan kurulan sayım bunları görmüyordu.
 *
 * İstisna — belgeden sayılan ürünler: hizmet ve REÇETELİ ürünün kendi stok
 * hareketi yoktur (Latte satılınca süt ve kahve düşer, Latte değil). Bunların
 * satış adedi belge kalemlerinden gelir (`documentSold`); hareketten gelen satış
 * o ürün için yok sayılır, iki kaynak toplanırsa aynı satış iki kez sayılır.
 */

import { signedMovementQuantity } from "@/lib/stock/movement-sign"

/** Hareketin referans verdiği belgenin ailesi. */
export type DocFamily = "SALES" | "PURCHASE" | "WAYBILL" | "UNKNOWN"

export type FlowMovement = {
  productId: string
  type: string
  quantity: unknown
  reason?: string | null
  reference?: string | null
  description?: string | null
}

export type ProductFlow = {
  /** Dönem girişi (alış, irsaliye, elle giriş, açılış) — alış iptali düşer. */
  inbound: number
  /** Net satış adedi (iadeler düşülmüş). */
  sold: number
  /** Reçeteyle bileşen olarak tüketilen. */
  recipe: number
  /** Kalan her şey, İŞARETLİ (− çıkış, + fazla). */
  other: number
}

/** Reçete bileşeni düşümü açıklaması bu işareti taşır (lib/stock/invoice-stock.ts). */
const RECIPE_MARK = "Reçete:"

export const emptyFlow = (): ProductFlow => ({ inbound: 0, sold: 0, recipe: 0, other: 0 })

const round4 = (n: number) => Math.round(n * 10000) / 10000

/**
 * Hareketleri ürün bazında dört sütuna ayırır.
 *
 * Reçete ayrımı (belge, ürün) ÇİFTİ üzerinden yapılır: fiş iptalinde bileşenin
 * geri girişi "Fatura iptali (stok iade)" açıklamasıyla yazılır, "Reçete:"
 * işaretini taşımaz. Tek tek bakılsaydı iptal edilen Latte'nin sütü eksi
 * SATIŞ olarak görünürdü. Aynı fişte aynı ürün hem doğrudan satılıp hem bileşen
 * olarak düşerse ikisi birden reçeteye yazılır — ölçülen veride böyle bir fiş yok.
 */
export function classifyStockFlows(
  movements: FlowMovement[],
  familyOf: (reference: string) => DocFamily,
): Map<string, ProductFlow> {
  const recipePairs = new Set<string>()
  for (const m of movements) {
    if (m.reference && m.description?.includes(RECIPE_MARK)) {
      recipePairs.add(`${m.reference}\u0000${m.productId}`)
    }
  }

  const flows = new Map<string, ProductFlow>()
  for (const m of movements) {
    if (m.type === "TRANSFER") continue
    const signed = signedMovementQuantity(m)
    if (signed === 0) continue
    const flow = flows.get(m.productId) ?? emptyFlow()
    flows.set(m.productId, flow)

    // Sayım/ikram/zayi ADJUSTMENT yazar — belgeye bağlı olsa bile satış değildir
    // (adisyon ikramı fişin id'sini referans alır).
    const documentMove = m.type !== "ADJUSTMENT"
    const family = m.reference ? familyOf(m.reference) : null

    if (documentMove && family === "SALES") {
      if (recipePairs.has(`${m.reference}\u0000${m.productId}`)) flow.recipe -= signed
      else flow.sold -= signed
    } else if (documentMove && (family === "PURCHASE" || family === "WAYBILL")) {
      flow.inbound += signed
    } else if (!m.reference && documentMove && signed > 0) {
      // Elle giriş ve açılış stoğu.
      flow.inbound += signed
    } else if (!m.reference && signed < 0 && m.reason === "SALE") {
      // Faturasız satış: çıkış penceresinde nedeni "Satış" seçilmiş.
      flow.sold -= signed
    } else {
      // Fire/zayi/numune, nedeni sorulmamış eski çıkış, sayım farkı, ikram ve
      // silinmiş bir belgeden kalan hareket (UNKNOWN).
      flow.other += signed
    }
  }

  for (const flow of flows.values()) {
    flow.inbound = round4(flow.inbound)
    flow.sold = round4(flow.sold)
    flow.recipe = round4(flow.recipe)
    flow.other = round4(flow.other)
  }
  return flows
}

/**
 * Belgeden sayılan ürünlerin (hizmet, reçeteli) satışını akışa yazar. Hareketten
 * gelmiş satış bu ürünlerde EZİLİR — iki kaynak toplanmaz.
 */
export function applyDocumentSales(
  flows: Map<string, ProductFlow>,
  documentProductIds: Set<string>,
  documentSold: Map<string, number>,
): Map<string, ProductFlow> {
  for (const productId of documentProductIds) {
    const flow = flows.get(productId) ?? emptyFlow()
    flow.sold = round4(documentSold.get(productId) ?? 0)
    flows.set(productId, flow)
  }
  return flows
}
