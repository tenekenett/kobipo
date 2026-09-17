/**
 * Çek/senet portföyünün DURUMA GÖRE özeti — saf kural, ekran ve test ortak kullanır.
 *
 * Liste ucu (`/api/cek-senet`) firmanın tüm kayıtlarını döner (sayfalama
 * istemcide), o yüzden toplam istemcide alınan listeden kurulur; ayrı bir
 * özet ucu açmak aynı rakamı iki yerden hesaplatır ve ayrıştırırdı.
 *
 * Alınan ile verilen AYRI tutulur: portföydeki alınan çek alacaktır, verilen
 * çek borç. İkisini tek rakamda toplamak "portföyde 120.000 ₺" gibi ne tahsil
 * edilecek ne ödenecek bir sayı üretir. Kart tek toplamı basar ama yön
 * kırılımını da yazar.
 */

import { CEK_SENET_STATUSES, resolveCekSenetDirection } from "./labels"

export type CekSenetOzetItem = {
  amount: number | string
  status: string
  direction?: string | null
  supplier?: { id: string } | null
}

export type DurumToplami = {
  status: string
  count: number
  total: number
  /** Alınan (RECEIVED) kayıtların toplamı. */
  received: number
  /** Verilen (GIVEN) kayıtların toplamı. */
  given: number
}

export type CekSenetOzet = {
  /** `CEK_SENET_STATUSES` sırasıyla; listede olmayan (eski/bozuk) durumlar sona eklenir. */
  byStatus: DurumToplami[]
  all: DurumToplami
}

const bos = (status: string): DurumToplami => ({ status, count: 0, total: 0, received: 0, given: 0 })

const round2 = (n: number) => Math.round(n * 100) / 100

function ekle(hedef: DurumToplami, amount: number, direction: "RECEIVED" | "GIVEN") {
  hedef.count += 1
  hedef.total += amount
  if (direction === "GIVEN") hedef.given += amount
  else hedef.received += amount
}

function kapat(t: DurumToplami): DurumToplami {
  return { ...t, total: round2(t.total), received: round2(t.received), given: round2(t.given) }
}

export function cekSenetOzeti(items: readonly CekSenetOzetItem[]): CekSenetOzet {
  const map = new Map<string, DurumToplami>()
  for (const s of CEK_SENET_STATUSES) map.set(s, bos(s))
  const all = bos("ALL")

  for (const item of items) {
    const amount = Number(item.amount)
    if (!Number.isFinite(amount)) continue
    const direction = resolveCekSenetDirection({
      direction: item.direction,
      supplierId: item.supplier?.id ?? null,
    })
    let hedef = map.get(item.status)
    if (!hedef) {
      hedef = bos(item.status)
      map.set(item.status, hedef)
    }
    ekle(hedef, amount, direction)
    ekle(all, amount, direction)
  }

  return {
    byStatus: Array.from(map.values()).map(kapat),
    all: kapat(all),
  }
}
