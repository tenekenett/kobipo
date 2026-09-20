/**
 * TAHSİLAT/ÖDEME TUTARININ FATURALARA DAĞITIMI — saf kural.
 *
 * Kullanıcı birden çok açık fatura seçer, TEK tutar girer. Tutar faturalara
 * verilen SIRAYLA (çağıran eskiden yeniye verir) dağıtılır: her fatura açık
 * tutarı kadar alır, kalan bir sonrakine geçer. Artan tutar `remainder` olarak
 * döner — nakit/bankada avans kalır, bakiye kapamada izin verilmez (kararı
 * çağıran verir; burada yalnız hesap var).
 *
 * Kuruş aritmetiği TAM SAYIYLA yapılır: 0,1 + 0,2 ≠ 0,3 tuzağı gerçek veride
 * "tutar açık kısımdan büyük" hatası üretmişti (bkz. faturalar/odemeler POST).
 *
 * Sunucu (uçlar) ve istemci (önizleme) AYNI fonksiyonu çağırır; ikisi ayrı
 * hesaplasaydı ekranda "3 faturaya dağıtıldı" görünürken kayıt 2'ye düşerdi.
 */

export type DagitilacakFatura = { id: string; openAmount: number }

export type FaturaPayi = { invoiceId: string; amount: number }

export type DagitimSonucu = {
  allocations: FaturaPayi[]
  /** Hiçbir faturaya sığmayan kısım (avans). */
  remainder: number
  /** Faturalara yazılan toplam. */
  allocated: number
}

const kurus = (n: number) => Math.round((Number(n) || 0) * 100)
const lira = (k: number) => k / 100

export function odemeDagit(amount: number, invoices: DagitilacakFatura[]): DagitimSonucu {
  let kalan = Math.max(0, kurus(amount))
  const allocations: FaturaPayi[] = []
  for (const inv of invoices) {
    if (kalan <= 0) break
    const acik = Math.max(0, kurus(inv.openAmount))
    if (acik <= 0) continue
    const pay = Math.min(acik, kalan)
    allocations.push({ invoiceId: inv.id, amount: lira(pay) })
    kalan -= pay
  }
  const allocated = allocations.reduce((s, a) => s + kurus(a.amount), 0)
  return { allocations, remainder: lira(kalan), allocated: lira(allocated) }
}

/** Seçili faturaların açık toplamı (kuruş hassasiyetinde). */
export function acikToplam(invoices: DagitilacakFatura[]): number {
  return lira(invoices.reduce((s, inv) => s + Math.max(0, kurus(inv.openAmount)), 0))
}
