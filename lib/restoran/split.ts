// Adisyonu AYRI HESAPLARA bölme — SAF kural. Plan: docs/okc/ASAMA1-KOBIPO.md A4
// (docs/restoran/SATIS-EKRANI.md F4).
//
// "Hesabı böl"ün iki anlamı var ve ikisi AYRI yoldur:
//   1. Ödemede bölme  → fiş TEK, tahsilat parçalı (components/restoran/split-dialog.tsx)
//   2. Ayrı hesaplar  → her parça KENDİ adisyonu, kendi fişi (bu dosya)
//
// Kalemler TAŞINIR, kopyalanmaz (birleştirmeyle aynı gerekçe: kopya, stok
// düşümünü ve ikram sayımını ikiye katlardı). Adet bölünebilir: "3 çaydan 1'i
// bende" — kaynak satırın miktarı azalır, parçada yeni satır açılır.
//
// Yalnız ödenecek (NORMAL) kalem taşınır. İkram/zayi/iptal kaynakta kalır ve
// stoğu kaynağın kapanışında düşer — bugünkü kural (comp-waste-stock).

import { grossDiscountOf, type TicketDiscount } from "@/lib/restoran/ticket-constants"

const EPS = 1e-6
/** Kalem miktarı Decimal(14,4) — taşınan miktar da o hassasiyete yuvarlanır. */
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10_000) / 10_000
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export type SplitSourceItem = {
  id: string
  quantity: number
  status: string
  unitPrice: number
  vatRate: number
}

export type SplitPartInput = { items: Array<{ itemId: string; quantity: number }> }

/**
 * Bir taşıma. `reuseRow`: kaynağın satırı olduğu gibi parçaya geçer (miktarın
 * TAMAMI ya da tamamlayan son pay taşınıyor); aksi halde parçada yeni satır açılır.
 */
export type SplitMove = { partIndex: number; itemId: string; quantity: number; reuseRow: boolean }

export type SplitPlan =
  | { ok: true; moves: SplitMove[]; sourceRemaining: Record<string, number> }
  | { ok: false; error: string }

/** Gövdeyi okur: `parts: [{ items: [{ itemId, quantity }] }]`. */
export function parseSplitParts(body: unknown): SplitPartInput[] | string {
  const raw = (body as { parts?: unknown })?.parts
  if (!Array.isArray(raw) || raw.length === 0) return "En az bir yeni hesap tanımlanmalı"
  if (raw.length > 10) return "Tek seferde en fazla 10 hesap ayrılabilir"
  const parts: SplitPartInput[] = []
  for (const part of raw) {
    const items = (part as { items?: unknown })?.items
    if (!Array.isArray(items) || items.length === 0) return "Her yeni hesapta en az bir kalem olmalı"
    const parsed: SplitPartInput["items"] = []
    for (const entry of items) {
      const itemId = String((entry as { itemId?: unknown })?.itemId ?? "")
      const quantity = round4(Number((entry as { quantity?: unknown })?.quantity))
      if (!itemId) return "Kalem seçilmeli"
      if (!Number.isFinite(quantity) || quantity <= 0) return "Taşınan miktar sıfırdan büyük olmalı"
      parsed.push({ itemId, quantity })
    }
    parts.push({ items: parsed })
  }
  return parts
}

/**
 * Taşıma planı. Reddeder: bilinmeyen/ödenmeyecek kalem, kalemin miktarını aşan
 * toplam, kaynakta ödenecek hiçbir şey bırakmayan bölme ("hesabın tamamını
 * taşımak" bölme değil masa taşımadır — o yol ayrı).
 */
export function planTicketSplit(items: SplitSourceItem[], parts: SplitPartInput[]): SplitPlan {
  const byId = new Map(items.map((item) => [item.id, item]))
  const requested = new Map<string, Array<{ partIndex: number; quantity: number }>>()

  for (const [partIndex, part] of parts.entries()) {
    for (const entry of part.items) {
      const item = byId.get(entry.itemId)
      if (!item) return { ok: false, error: "Kalem bu adisyonda değil" }
      if ((item.status ?? "NORMAL") !== "NORMAL") {
        return { ok: false, error: "İkram, zayi ya da iptal kalemi ayrı hesaba taşınamaz" }
      }
      const list = requested.get(item.id) ?? []
      list.push({ partIndex, quantity: entry.quantity })
      requested.set(item.id, list)
    }
  }

  const moves: SplitMove[] = []
  const sourceRemaining: Record<string, number> = {}
  for (const [itemId, list] of requested) {
    const item = byId.get(itemId)!
    const total = round4(list.reduce((s, m) => s + m.quantity, 0))
    if (total > item.quantity + EPS) {
      return { ok: false, error: "Taşınan miktar kalemin miktarını aşıyor" }
    }
    const remaining = round4(item.quantity - total)
    const takesAll = remaining <= EPS
    list.forEach((m, index) => {
      // Miktarın tamamı gidiyorsa SON pay satırın kendisini alır; kaynakta sıfır
      // miktarlı satır kalmaz.
      moves.push({ ...m, itemId, reuseRow: takesAll && index === list.length - 1 })
    })
    sourceRemaining[itemId] = takesAll ? 0 : remaining
  }

  const billableLeft = items.some(
    (item) =>
      (item.status ?? "NORMAL") === "NORMAL" && (sourceRemaining[item.id] ?? item.quantity) > EPS,
  )
  if (!billableLeft) {
    return { ok: false, error: "Hesabın tamamı ayrılamaz; bu hesapta en az bir kalem kalmalı" }
  }

  return { ok: true, moves, sourceRemaining }
}

/** Kalemlerin KDV dahil, iskonto öncesi tutarı. */
export function grossOf(lines: Array<{ quantity: number; unitPrice: number; vatRate: number }>): number {
  return lines.reduce((s, l) => s + l.quantity * l.unitPrice * (1 + l.vatRate / 100), 0)
}

/**
 * Hesap iskontosunun parçalara dağılımı.
 *  - YÜZDE → her hesaba aynı yüzde (kimin ne yediğinden bağımsız "%10 indirim").
 *  - TUTAR → brüt oranında dağılır, kuruş kalanı KAYNAKTA kalır; toplam aynen korunur.
 * Kaynak ve parçalar bölmeden SONRAKİ brüt tutarlarıyla verilir.
 */
export function splitTicketDiscount(
  discount: TicketDiscount,
  sourceGross: number,
  partGrosses: number[],
): { source: TicketDiscount; parts: TicketDiscount[] } {
  if (!discount) return { source: null, parts: partGrosses.map(() => null) }
  if (discount.type === "PERCENT") {
    return { source: discount, parts: partGrosses.map(() => ({ ...discount })) }
  }

  const totalGross = sourceGross + partGrosses.reduce((s, g) => s + g, 0)
  if (!(totalGross > 0)) return { source: discount, parts: partGrosses.map(() => null) }

  // Tutar hesabı aşamaz — ekranda görünen iskontoyla aynı kırpma (grossDiscountOf).
  const amount = round2(grossDiscountOf(discount, totalGross))
  const shares = partGrosses.map((g) => round2((amount * g) / totalGross))
  const sourceShare = round2(amount - shares.reduce((s, v) => s + v, 0))
  const asDiscount = (value: number): TicketDiscount => (value > 0 ? { type: "AMOUNT", value } : null)
  return { source: asDiscount(sourceShare), parts: shares.map(asDiscount) }
}
