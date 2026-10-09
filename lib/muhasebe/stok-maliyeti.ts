/**
 * AYLIK SATILAN MALIN MALİYETİ — ay sonu stok değerlemesiyle. Saf modül; uygulama
 * `stok-maliyeti.server.ts`, ekran `/muhasebe/ay-sonu` (2026-10-09, eksik turu B4).
 *
 * Alışlar 153 Ticari Mallar'a borç yazılır (fis-kurallari.ts); satışta maliyet yazılmaz.
 * Bugüne kadar maliyet yalnız YIL SONU sayımıyla hesaplanıyor, yıl içinde gelir tablosunda
 * brüt kâr net satışa eşit görünüyordu. Kobipo stok miktarını ve ağırlıklı ortalama maliyeti
 * zaten biliyor (lib/stock/cost.ts), bu yüzden her ay sonu:
 *
 *   stok değeri      = Σ ürün (ay sonu miktarı × o güne kadarki ağırlıklı ortalama maliyet)
 *   faturasız giriş  = ayın FATURAYA BAĞLI OLMAYAN stok girişleri (ürün kartından "Açılış stoğu",
 *                      elle stok düzeltmesi; ürün başına net, yalnız artısı) × aynı ay sonu
 *                      ortalama maliyet
 *   maliyet          = 153 bakiyesi + faturasız giriş − stok değeri
 *
 *   faturasız giriş  → B 153 · A 397 Sayım ve Tesellüm Fazlaları
 *   maliyet > 0      → B 621 Satılan Ticari Mallar Maliyeti · A 153
 *   maliyet < 0      → B 153 · A 621   (iade ya da geç girilen alış — uyarıyla)
 *
 * Faturasız giriş ayrı satırdır (2026-10-09, kullanıcı kararı): 153'ten geçmeden stoğa giren mal
 * maliyetten DÜŞÜLSEYDİ kâr şişerdi. Ölçüm: Reypo'da 181 adetlik fiyatsız düzeltme Temmuz
 * maliyetini −2,5 milyon TL yapıyordu; gerçek müşteri HİDROEREN stoğunu 505 elle hareketle
 * ("Açılış stoğu", "Ürün kartından stok düzeltmesi") kurmuş. 397 geçici hesaptır: muhasebeci yıl
 * sonunda nereye aktarılacağına karar verir (geç girilmiş açılış stoğu mu, sayım fazlası mı).
 * Faturasız ÇIKIŞLAR (fire, numune, sayım eksiği) bilerek maliyette kalır: kârı şişirmezler.
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
  /** Ayın faturasız stok girişi (397'ye yazılır, maliyetten düşülmez). */
  faturasizGiris: number
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
  /** Ayın faturasız stok girişinin değeri (≥ 0); yoksa 0. */
  faturasizGiris?: number
  /** Maliyetin yazılacağı yaprak (621 ya da alt hesabı). */
  maliyetHesabi: string | null
  /** Stok azalışının yazılacağı yaprak (153 ya da alt hesabı). */
  stokYapragi: string | null
  /** Faturasız girişin karşılığı (397 ya da alt hesabı); giriş yoksa sorulmaz. */
  fazlaHesabi?: string | null
}): SmmPlani {
  const hatalar: string[] = []
  const uyarilar: string[] = []
  const stokHesabi = r2(g.stok153.reduce((a, h) => a + h.bakiye, 0))
  const stokDegeri = r2(g.stokDegeri)
  const faturasizGiris = r2(Math.max(0, g.faturasizGiris ?? 0))
  const maliyet = r2(stokHesabi + faturasizGiris - stokDegeri)
  const satirlar: MahsupSatiri[] = []
  if (maliyet === 0 && faturasizGiris === 0) {
    hatalar.push("Bu ay stok hesabıyla stok değeri aynı; yazılacak maliyet yok.")
  } else {
    if (maliyet !== 0 && !g.maliyetHesabi) hatalar.push("Satılan mal maliyeti hesabı (621) alt hesaplı; kullanılacak alt hesabı seçin.")
    if (!g.stokYapragi) hatalar.push("Ticari mallar hesabı (153) alt hesaplı; stoğun düşüleceği alt hesabı seçin.")
    if (faturasizGiris > 0 && !g.fazlaHesabi) {
      hatalar.push("Sayım ve tesellüm fazlaları hesabı (397) planda yok, pasif ya da alt hesaplı; kullanılacak hesabı seçin.")
    }
    if (hatalar.length === 0 && g.stokYapragi) {
      if (faturasizGiris > 0 && g.fazlaHesabi) {
        satirlar.push(
          { taraf: "B", kod: g.stokYapragi, tutar: faturasizGiris, aciklama: "Faturasız stok girişi (açılış stoğu, stok düzeltmesi)" },
          { taraf: "A", kod: g.fazlaHesabi, tutar: faturasizGiris, aciklama: "Sayım ve tesellüm fazlası — faturasız stok girişi" },
        )
      }
      if (maliyet !== 0 && g.maliyetHesabi) {
        const tutar = Math.abs(maliyet)
        satirlar.push(
          { taraf: maliyet > 0 ? "B" : "A", kod: g.maliyetHesabi, tutar, aciklama: "Satılan ticari mallar maliyeti" },
          { taraf: maliyet > 0 ? "A" : "B", kod: g.stokYapragi, tutar, aciklama: "Ticari mallar (ay sonu stok değerine göre)" },
        )
      }
    }
    if (maliyet < 0) {
      uyarilar.push(
        "Ay sonu stok değeri defterdeki ticari mal bakiyesinden yüksek: maliyet eksi çıkıyor. Satış iadesi ya da başka aya girilmiş bir alış olabilir; açılış stoğu girilmediyse açılış fişini kontrol edin.",
      )
    }
  }
  return { ay: g.ay, stokHesabi, stokDegeri, faturasizGiris, maliyet, satirlar, hatalar, uyarilar }
}

/** "2026-09" ayının İstanbul takvimiyle BAŞI: 1 Eylül 00:00 TSİ = 31 Ağustos 21:00 UTC. */
export function ayBaslangicAni(ay: string): Date {
  const [y, m] = ay.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, 1) - 3 * 3_600_000)
}

/** "2026-09" ayının İstanbul takvimiyle SONU (dışlayıcı sınır): 1 Ekim 00:00 TSİ = 30 Eylül 21:00 UTC. */
export function ayBitisAni(ay: string): Date {
  const [y, m] = ay.split("-").map(Number)
  return new Date(Date.UTC(y, m, 1) - 3 * 3_600_000)
}
