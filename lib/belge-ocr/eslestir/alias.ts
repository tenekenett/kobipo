/**
 * Kalem → ürün eşleşmesi: anahtar üretimi ve yerel (bellek içi) eşleştirme. Saf,
 * istemcide de koşar. Kalıcı harita `cari_product_aliases` tablosundadır
 * (/api/alis/belge-tarama/alias); burada yalnız kural var.
 *
 * Anahtar SIRASI: satıcı kodu › kalem adı (ikisi de trFold ile katlanır —
 * CLAUDE.md "Arama Türkçe duyarsızdır"). Kod varken ad kullanılmaz: aynı kodun
 * adı faturadan faturaya değişir ("LASTİK 7.00-12" / "Lastik 7,00x12"), kod değişmez.
 *
 * Yerel eşleştirme (alias yoksa): ürün adı/kodu/barkodu ile TAM katlanmış eşitlik.
 * Bulanık eşleşme BİLEREK yok: "yanlış ürüne stok girmek" sessiz bir hatadır,
 * eşleşmeyen satırı kullanıcı seçer ve alias öğrenir.
 */

import { trFold } from "@/lib/text/tr-fold"

export type AliasAnahtari = { key: string; label: string; kaynak: "kod" | "ad" }

const katla = (s: string | null | undefined) => trFold(s ?? "").replace(/\s+/g, " ").trim()

export function aliasAnahtari(k: { saticiKodu?: string | null; ad: string }): AliasAnahtari | null {
  const kod = katla(k.saticiKodu)
  if (kod) return { key: "kod:" + kod, label: k.saticiKodu!.trim(), kaynak: "kod" }
  const ad = katla(k.ad)
  if (ad) return { key: "ad:" + ad, label: k.ad.trim(), kaynak: "ad" }
  return null
}

export type UrunOzeti = { id: string; name: string; code?: string | null; barcode?: string | null }

/** Ürün listesinden katlanmış ad/kod/barkod → id sözlüğü. */
export function urunSozlugu(urunler: UrunOzeti[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const p of urunler) {
    for (const a of [p.code, p.barcode, p.name]) {
      const k = katla(a)
      if (k && !m.has(k)) m.set(k, p.id)
    }
  }
  return m
}

/**
 * Kalemleri ürüne eşler: önce alias haritası (key → productId), sonra yerel
 * tam eşitlik (satıcı kodu = bizim kod/barkod, ya da ad = bizim ad).
 * Dönüş: kalem sırası → productId; kaynak bilgisi kart rozetinde gösterilir.
 */
export function kalemleriEsle(
  kalemler: Array<{ saticiKodu?: string | null; ad: string }>,
  aliaslar: Map<string, string>,
  sozluk: Map<string, string>
): Map<number, { productId: string; kaynak: "alias" | "kod" | "ad" }> {
  const sonuc = new Map<number, { productId: string; kaynak: "alias" | "kod" | "ad" }>()
  kalemler.forEach((k, i) => {
    const anahtar = aliasAnahtari(k)
    if (anahtar) {
      const a = aliaslar.get(anahtar.key)
      if (a) {
        sonuc.set(i, { productId: a, kaynak: "alias" })
        return
      }
    }
    const kod = katla(k.saticiKodu)
    if (kod && sozluk.has(kod)) {
      sonuc.set(i, { productId: sozluk.get(kod)!, kaynak: "kod" })
      return
    }
    const ad = katla(k.ad)
    if (ad && sozluk.has(ad)) sonuc.set(i, { productId: sozluk.get(ad)!, kaynak: "ad" })
  })
  return sonuc
}
