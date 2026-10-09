/**
 * AYLIK SATILAN MALIN MALİYETİ — ay sonu stok değerlemesiyle. Saf modül; uygulama
 * `stok-maliyeti.server.ts`, ekran `/muhasebe/ay-sonu` (2026-10-09, eksik turu B4).
 *
 * Alışlar 153 Ticari Mallar'a borç yazılır (fis-kurallari.ts); satışta maliyet yazılmaz.
 * Bugüne kadar maliyet yalnız YIL SONU sayımıyla hesaplanıyor, yıl içinde gelir tablosunda
 * brüt kâr net satışa eşit görünüyordu. Kobipo stok miktarını ve ağırlıklı ortalama maliyeti
 * zaten biliyor (lib/stock/cost.ts), bu yüzden her ay sonu:
 *
 *   stok değeri = Σ ürün (ay sonu miktarı × o güne kadarki ağırlıklı ortalama maliyet)
 *   maliyet     = 153 bakiyesi − stok değeri
 *
 *   maliyet > 0 → B 621 Satılan Ticari Mallar Maliyeti · A 153
 *   maliyet < 0 → B 153 · A 621   (iade, sayım fazlası ya da geç girilen alış — uyarıyla)
 *
 * Reçeteli satış (restoran), fire ve ikram da stok hareketi olduğu için kendiliğinden
 * maliyete girer; satış başına maliyet hesaplamaya gerek kalmaz. Yıl sonu kapanışında
 * sayım tutarı girilirse yalnız sayım farkı kalır (kapanis.ts → smm adımı).
 */

import { r2 } from "@/lib/muhasebe/fis"
import type { MahsupSatiri, YaprakBakiye } from "@/lib/muhasebe/kdv-mahsup"

export type SmmPlani = {
  ay: string
  /** 153'ün ay sonu bakiyesi (bütün yapraklar). */
  stokHesabi: number
  /** Kobipo stok kayıtlarından ay sonu stok değeri. */
  stokDegeri: number
  /** Bu ayın satılan malın maliyeti (eksi olabilir). */
  maliyet: number
  satirlar: MahsupSatiri[]
  hatalar: string[]
  uyarilar: string[]
}

export function smmPlani(g: {
  ay: string
  stok153: YaprakBakiye[]
  stokDegeri: number
  /** Maliyetin yazılacağı yaprak (621 ya da alt hesabı). */
  maliyetHesabi: string | null
  /** Stok azalışının yazılacağı yaprak (153 ya da alt hesabı). */
  stokYapragi: string | null
}): SmmPlani {
  const hatalar: string[] = []
  const uyarilar: string[] = []
  const stokHesabi = r2(g.stok153.reduce((a, h) => a + h.bakiye, 0))
  const stokDegeri = r2(g.stokDegeri)
  const maliyet = r2(stokHesabi - stokDegeri)
  const satirlar: MahsupSatiri[] = []
  if (maliyet === 0) {
    hatalar.push("Bu ay stok hesabıyla stok değeri aynı; yazılacak maliyet yok.")
  } else {
    if (!g.maliyetHesabi) hatalar.push("Satılan mal maliyeti hesabı (621) alt hesaplı; kullanılacak alt hesabı seçin.")
    if (!g.stokYapragi) hatalar.push("Ticari mallar hesabı (153) alt hesaplı; stoğun düşüleceği alt hesabı seçin.")
    if (g.maliyetHesabi && g.stokYapragi) {
      const tutar = Math.abs(maliyet)
      satirlar.push(
        { taraf: maliyet > 0 ? "B" : "A", kod: g.maliyetHesabi, tutar, aciklama: "Satılan ticari mallar maliyeti" },
        { taraf: maliyet > 0 ? "A" : "B", kod: g.stokYapragi, tutar, aciklama: "Ticari mallar (ay sonu stok değerine göre)" },
      )
    }
    if (maliyet < 0) {
      uyarilar.push(
        "Ay sonu stok değeri defterdeki ticari mal bakiyesinden yüksek: maliyet eksi çıkıyor. Satış iadesi, sayım fazlası ya da başka aya girilmiş bir alış olabilir; açılış stoğu girilmediyse açılış fişini kontrol edin.",
      )
    }
  }
  return { ay: g.ay, stokHesabi, stokDegeri, maliyet, satirlar, hatalar, uyarilar }
}

/** "2026-09" ayının İstanbul takvimiyle SONU (dışlayıcı sınır): 1 Ekim 00:00 TSİ = 30 Eylül 21:00 UTC. */
export function ayBitisAni(ay: string): Date {
  const [y, m] = ay.split("-").map(Number)
  return new Date(Date.UTC(y, m, 1) - 3 * 3_600_000)
}
