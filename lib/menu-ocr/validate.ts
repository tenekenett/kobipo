/**
 * Menü denetimleri — saf (plan §3.7). Hiçbiri "doğru" demez; "insana sor" der.
 *
 * İki düzey:
 *   • oturum: menüye benziyor mu, para birimi, KDV notu, sütun kayması şüphesi,
 *     başlık sanılan satırlar, düşük güven
 *   • kalem: fiyat aykırılığı (medyanın 20 katı / 20'de biri), tekrar eden ad
 *     farklı fiyatla, etiketsiz varyant
 */

import type { Denetim, MenuKalemBirlesik } from "./turler"
import type { OturumBirlesimi } from "./tekillestir"

/** Medyandan bu kadar uzak fiyat OCR hatasıdır (₺5 kahve, ₺5.000 çay). */
export const AYKIRI_KAT = 20
/** Aynı fiyat arka arkaya bu kadar tekrar ederse sütun kayması şüphesi. */
export const TEKRAR_ESIGI = 8
export const DUSUK_GUVEN = 0.6

export function medyan(sayilar: number[]): number | null {
  if (sayilar.length === 0) return null
  const s = [...sayilar].sort((a, b) => a - b)
  const o = Math.floor(s.length / 2)
  return s.length % 2 ? s[o] : (s[o - 1] + s[o]) / 2
}

/** Menüye benziyor mu — fiyatlı en az bir kalem. Yoksa uç ürün üretmez (§3.1). */
export function menuyeBenziyorMu(b: Pick<OturumBirlesimi, "kalemler">): boolean {
  return b.kalemler.some((k) => k.fiyatlar.length > 0)
}

export function oturumDenetle(b: OturumBirlesimi): Denetim[] {
  const s: Denetim[] = []

  s.push(
    b.kalemler.length === 0
      ? { anahtar: "kalem", etiket: "Kalem", durum: "patladi", aciklama: "Fiyatlı hiçbir kalem okunamadı — bu bir menüye benzemiyor" }
      : { anahtar: "kalem", etiket: "Kalem", durum: "gecti", aciklama: `${b.kalemler.length} kalem, ${b.bolumler.length} bölüm, ${b.toplamSayfa} sayfa` }
  )

  if (b.fiyatsizSatir > 0) {
    s.push({ anahtar: "baslik", etiket: "Başlık satırı", durum: "olcelemedi", aciklama: `${b.fiyatsizSatir} fiyatsız satır başlık sayılıp atıldı` })
  }
  if (b.tekrar > 0) {
    const cakisan = b.kalemler.filter((k) => k.cakisanFiyatlar.length > 0).length
    s.push({
      anahtar: "tekrar",
      etiket: "Tekrar",
      durum: cakisan > 0 ? "patladi" : "gecti",
      aciklama: cakisan > 0 ? `${cakisan} ürün iki farklı fiyatla geçiyor — ilk görülen alındı, satırlara bakın` : `${b.tekrar} tekrar eden ad teke indirildi`,
    })
  }

  const yabanci = b.paraBirimleri.filter((p) => p !== "TRY")
  s.push(
    yabanci.length > 0
      ? { anahtar: "para", etiket: "Para birimi", durum: "patladi", aciklama: `Menüde ${yabanci.join(", ")} okundu; ürünler TRY olarak kaydedilir` }
      : { anahtar: "para", etiket: "Para birimi", durum: b.paraBirimleri.length ? "gecti" : "olcelemedi", aciklama: b.paraBirimleri.length ? "TRY" : "Para birimi simgesi okunmadı; TRY varsayıldı" }
  )

  const kdvNotu = b.kdvNotlari.join(" · ")
  if (/hari[cç]/i.test(kdvNotu)) {
    s.push({ anahtar: "kdv", etiket: "KDV notu", durum: "patladi", aciklama: `Menü "${kdvNotu}" diyor — fiyatlar KDV HARİÇ olabilir; oranı ve fiyatları kontrol edin` })
  } else if (kdvNotu) {
    s.push({ anahtar: "kdv", etiket: "KDV notu", durum: "gecti", aciklama: kdvNotu })
  }

  // Sütun kayması şüphesi: aynı fiyat arka arkaya çok tekrar ediyorsa sağ
  // kolonun fiyatları sola kaymış olabilir. Zayıf sinyal (tüm çaylar 40 ₺ de
  // olabilir) — "ölçülemedi" düzeyinde, kullanıcı satırlara bakar.
  let enUzun = 0
  let seri = 0
  let onceki: number | null = null
  for (const k of b.kalemler) {
    const f = k.fiyatlar[0]?.fiyat ?? null
    seri = f != null && onceki != null && Math.abs(f - onceki) < 0.005 ? seri + 1 : 1
    enUzun = Math.max(enUzun, seri)
    onceki = f
  }
  if (enUzun >= TEKRAR_ESIGI) {
    s.push({ anahtar: "sutun", etiket: "Sütun", durum: "olcelemedi", aciklama: `Aynı fiyat arka arkaya ${enUzun} kez — iki kolonlu menüde ad/fiyat eşleşmesi kaymış olabilir` })
  }

  if (b.enDusukGuven < DUSUK_GUVEN) {
    s.push({ anahtar: "guven", etiket: "Okuma güveni", durum: "patladi", aciklama: `Model bir sayfada güveni ${Math.round(b.enDusukGuven * 100)}% verdi — fotoğraf eğik/yansımalı olabilir` })
  }
  return s
}

/** Kalem düzeyi denetimler; `medyanFiyat` oturumdaki tüm taban fiyatların medyanı. */
export function kalemDenetle(k: MenuKalemBirlesik, medyanFiyat: number | null): Denetim[] {
  const s: Denetim[] = []
  const taban = Math.min(...k.fiyatlar.map((f) => f.fiyat))
  if (medyanFiyat != null && medyanFiyat > 0) {
    if (taban > medyanFiyat * AYKIRI_KAT) {
      s.push({ anahtar: "aykiri", etiket: "Fiyat", durum: "patladi", aciklama: `${taban} ₺ menü medyanının (${medyanFiyat} ₺) ${AYKIRI_KAT} katından fazla — OCR hatası olabilir` })
    } else if (taban * AYKIRI_KAT < medyanFiyat) {
      s.push({ anahtar: "aykiri", etiket: "Fiyat", durum: "patladi", aciklama: `${taban} ₺ menü medyanının (${medyanFiyat} ₺) ${AYKIRI_KAT}'de birinden az — OCR hatası olabilir` })
    }
  }
  if (k.cakisanFiyatlar.length > 0) {
    const digerleri = k.cakisanFiyatlar.map((c) => c.map((f) => f.fiyat).join("/")).join(", ")
    s.push({ anahtar: "tekrar", etiket: "Tekrar", durum: "patladi", aciklama: `Aynı ad başka sayfada farklı fiyatla: ${digerleri} ₺` })
  }
  if (k.fiyatlar.length > 1 && k.fiyatlar.some((f) => !f.etiket)) {
    s.push({ anahtar: "etiket", etiket: "Varyant", durum: "olcelemedi", aciklama: "Çok fiyatlı satırda sütun başlığı okunamadı; seçenek adlarını düzeltin" })
  }
  return s
}

export function medyanTabanFiyat(kalemler: MenuKalemBirlesik[]): number | null {
  return medyan(kalemler.map((k) => Math.min(...k.fiyatlar.map((f) => f.fiyat))))
}
