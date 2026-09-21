/**
 * Oturum içi birleştirme ve tekilleştirme (plan §3.2). Saf.
 *
 * Girdi: oturumun dosyaları, yüklenme sırasıyla, her biri sayfa sayfa okuma.
 * Çıktı: menü kalemleri (aynı ad iki sayfada geçerse teke iner) + oturum
 * düzeyi notlar. Bu olmadan "menüde yok" hesabı (§3.8) da yanlış olurdu.
 *
 * Bölüm devri: sayfa başlıksız başlıyorsa (ilk kalemlerin `bolum`u null) önceki
 * sayfanın son bölümü sürer — "SICAK İÇECEKLER" 1. sayfada başlayıp 2. sayfaya
 * taşan menü. Model sayfayı tek başına gördüğü için bunu bilemez, burası bilir.
 */

import { trFold } from "@/lib/text/tr-fold"
import type { MenuFiyat, MenuKalemBirlesik, MenuOkuma } from "./turler"

export type OturumDosyasi = {
  scanId: string
  dosya: string
  sayfalar: MenuOkuma[]
}

export type OturumBirlesimi = {
  kalemler: MenuKalemBirlesik[]
  /** Tüm bölümler, ilk görülme sırasıyla, tekil (trFold) */
  bolumler: string[]
  kdvNotlari: string[]
  paraBirimleri: string[]
  /** Başlık sanılıp atılan fiyatsız satır sayısı */
  fiyatsizSatir: number
  /** Aynı adın ikinci kez görülüp teke indirildiği sayı */
  tekrar: number
  toplamSayfa: number
  /** Sayfa güvenlerinin en düşüğü — kart "okuma şüpheli" rozeti için */
  enDusukGuven: number
}

/** Fiyat kümesi eşit mi — etiketten bağımsız, sıralı sayı karşılaştırması. */
export function fiyatKumesiEsitMi(a: MenuFiyat[], b: MenuFiyat[]): boolean {
  if (a.length !== b.length) return false
  const sa = a.map((f) => f.fiyat).sort((x, y) => x - y)
  const sb = b.map((f) => f.fiyat).sort((x, y) => x - y)
  return sa.every((v, i) => Math.abs(v - sb[i]) < 0.005)
}

export function oturumBirlestir(dosyalar: OturumDosyasi[]): OturumBirlesimi {
  const kalemler: MenuKalemBirlesik[] = []
  const anahtarIndeksi = new Map<string, number>()
  const bolumler: string[] = []
  const bolumAnahtarlari = new Set<string>()
  const kdvNotlari: string[] = []
  const paraBirimleri: string[] = []
  let fiyatsizSatir = 0
  let tekrar = 0
  let toplamSayfa = 0
  let enDusukGuven = 1
  let sonBolum: string | null = null

  const bolumEkle = (b: string | null) => {
    if (!b) return
    const k = trFold(b)
    if (!k || bolumAnahtarlari.has(k)) return
    bolumAnahtarlari.add(k)
    bolumler.push(b)
  }

  for (const d of dosyalar) {
    for (const sayfa of d.sayfalar) {
      toplamSayfa++
      fiyatsizSatir += sayfa.fiyatsizSatir
      enDusukGuven = Math.min(enDusukGuven, sayfa.guven.kalemler, sayfa.guven.fiyatlar)
      if (sayfa.kdvNotu && !kdvNotlari.includes(sayfa.kdvNotu)) kdvNotlari.push(sayfa.kdvNotu)
      if (sayfa.paraBirimi && !paraBirimleri.includes(sayfa.paraBirimi)) paraBirimleri.push(sayfa.paraBirimi)
      for (const b of sayfa.bolumler) bolumEkle(b)

      for (const k of sayfa.kalemler) {
        const bolum = k.bolum ?? sonBolum
        if (k.bolum) sonBolum = k.bolum
        bolumEkle(bolum)
        const anahtar = trFold(k.ad)
        if (!anahtar) continue
        const kaynak = { scanId: d.scanId, dosya: d.dosya, sayfa: k.sayfa }
        const i = anahtarIndeksi.get(anahtar)
        if (i == null) {
          anahtarIndeksi.set(anahtar, kalemler.length)
          kalemler.push({ ...k, bolum, anahtar, kaynaklar: [kaynak], cakisanFiyatlar: [] })
          continue
        }
        tekrar++
        const mevcut = kalemler[i]
        mevcut.kaynaklar.push(kaynak)
        // Açıklama/bölüm ilk görülende boşsa ikincisinden tamamlanır; fiyat
        // ilk görülen kalır, farklıysa çakışma olarak yazılır (denetim sorar).
        if (!mevcut.aciklama && k.aciklama) mevcut.aciklama = k.aciklama
        if (!mevcut.bolum && bolum) mevcut.bolum = bolum
        if (!fiyatKumesiEsitMi(mevcut.fiyatlar, k.fiyatlar)) {
          const zatenVar = mevcut.cakisanFiyatlar.some((c) => fiyatKumesiEsitMi(c, k.fiyatlar))
          if (!zatenVar) mevcut.cakisanFiyatlar.push(k.fiyatlar)
        }
      }
    }
  }

  return { kalemler, bolumler, kdvNotlari, paraBirimleri, fiyatsizSatir, tekrar, toplamSayfa, enDusukGuven }
}
