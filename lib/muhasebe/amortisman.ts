/**
 * DEMİRBAŞ AMORTİSMANI — yıl sonu amortisman fişi. Saf modül (2026-10-09, eksik turu B5).
 *
 * Kaynak `FixedAsset` (Muhasebe → Demirbaşlar). Her demirbaş için defterin her yılına
 * 31 Aralık tarihli bir taslak fiş doğar (kaynak türü DEPRECIATION, kaynak id
 * "<demirbaş>:<yıl>"):  B 770 (gider, öğrenilir) · A 257 (maddi) / 268 (maddi olmayan).
 *
 * VUK kuralları (sadeleştirilmiş):
 *   - NORMAL: her yıl maliyet ÷ faydalı ömür. Alındığı yıl TAM yıl sayılır (kıst
 *     amortisman yalnız binek otomobilde — kapsam dışı, müşavir elle düzeltir).
 *   - AZALAN: kalan değer × (normal oranın iki katı, en çok %50); son yıl kalanın tamamı.
 *   - Son yıl (alındığı yıl + ömür − 1) kalan değer bütünüyle ayrılır; toplam maliyeti aşmaz.
 *   - Elden çıkarıldığı yıl ve sonrası amortisman ayrılmaz.
 *   - Defterden ÖNCEKİ yıllar `priorDepreciation`dadır (açılış fişinde 257/268).
 */

import { fisKur, hesapSec, r2, type FisSonucu, type HesapEslesmeleri } from "@/lib/muhasebe/fis"

export type DemirbasGirdisi = {
  id: string
  ad: string
  /** Varlık hesabı: 252–258 maddi, 260–267 maddi olmayan (alt hesabı da olabilir: 255.01). */
  hesapKodu: string
  alisTarihi: Date
  maliyet: number
  omur: number
  yontem: "NORMAL" | "AZALAN"
  /** Defter başlangıcından önce ayrılmış birikmiş amortisman. */
  oncekiAmortisman: number
  cikisTarihi: Date | null
}

/** Birikmiş amortisman (düzenleyici) hesabı: maddi 257, maddi olmayan 268. */
export function birikmisHesabi(hesapKodu: string): string {
  const kebir = hesapKodu.split(".")[0]
  return kebir.startsWith("26") ? "268" : "257"
}

/**
 * Yıl yıl amortisman tablosu (alındığı yıldan son yıla). `baslangicYili`ndan önceki
 * yılların toplamı `oncekiAmortisman` ile değiştirilir: defter öncesi müşavirin
 * kayıtlarından gelir, Kobipo'nun hesabı onu ezmez.
 */
export function amortismanTablosu(d: DemirbasGirdisi, baslangicYili: number): Array<{ yil: number; tutar: number; birikmis: number }> {
  const ilkYil = d.alisTarihi.getUTCFullYear()
  const sonYil = ilkYil + Math.max(1, d.omur) - 1
  const cikisYili = d.cikisTarihi ? d.cikisTarihi.getUTCFullYear() : null
  const maliyet = r2(d.maliyet)
  const oran = d.yontem === "AZALAN" ? Math.min(2 / Math.max(1, d.omur), 0.5) : 1 / Math.max(1, d.omur)
  const tablo: Array<{ yil: number; tutar: number; birikmis: number }> = []
  let birikmis = 0
  for (let yil = ilkYil; yil <= sonYil; yil++) {
    if (cikisYili !== null && yil >= cikisYili) break
    if (yil === baslangicYili && ilkYil < baslangicYili) birikmis = r2(Math.min(d.oncekiAmortisman, maliyet))
    const kalan = r2(maliyet - birikmis)
    if (kalan <= 0) break
    let tutar = yil === sonYil ? kalan : d.yontem === "AZALAN" ? r2(kalan * oran) : r2(maliyet * oran)
    tutar = Math.min(tutar, kalan)
    birikmis = r2(birikmis + tutar)
    if (yil >= baslangicYili) tablo.push({ yil, tutar, birikmis })
  }
  return tablo
}

/**
 * Defter başlangıcından önce ayrılmış olması GEREKEN amortisman — formda "önceki yıllar"
 * alanının önerisi (müşavirin kaydı farklıysa o girilir).
 */
export function oncekiAmortismanOnerisi(d: Omit<DemirbasGirdisi, "oncekiAmortisman">, baslangicYili: number): number {
  const tam = amortismanTablosu({ ...d, oncekiAmortisman: 0 }, d.alisTarihi.getUTCFullYear())
  return r2(tam.filter((s) => s.yil < baslangicYili).reduce((a, s) => a + s.tutar, 0))
}

/** Tarih itibarıyla birikmiş amortisman (defter öncesi dahil). */
export function birikmisAmortisman(d: DemirbasGirdisi, baslangicYili: number, yil: number): number {
  const once = d.alisTarihi.getUTCFullYear() < baslangicYili ? r2(Math.min(d.oncekiAmortisman, d.maliyet)) : 0
  return r2(once + amortismanTablosu(d, baslangicYili).filter((s) => s.yil <= yil).reduce((a, s) => a + s.tutar, 0))
}

/**
 * Bir yılın amortisman fişi: B gider (öğrenilir, anahtar varlığın kebirine bağlı —
 * taşıtlar başka, demirbaşlar başka gider hesabına gidebilir) · A birikmiş amortisman.
 */
export function amortismanFisi(d: DemirbasGirdisi, yil: number, baslangicYili: number, eslesme: HesapEslesmeleri): FisSonucu {
  const satir = amortismanTablosu(d, baslangicYili).find((s) => s.yil === yil)
  if (!satir || satir.tutar <= 0) return { durum: "fise-girmez", sebep: "Bu yıl için amortisman yok." }
  const kebir = d.hesapKodu.split(".")[0]
  const anahtar = `amortisman:gider:${kebir}`
  const birikmis = birikmisHesabi(d.hesapKodu)
  return fisKur({
    tarih: new Date(Date.UTC(yil, 11, 31)),
    aciklama: `${d.ad} — ${yil} amortismanı`,
    tur: "MAHSUP",
    satirlar: [
      {
        taraf: "B",
        tutar: satir.tutar,
        rol: "AMORTISMAN_GIDER",
        ...hesapSec(eslesme, [anahtar], "770"),
        oneriKodu: "770",
        anahtarlar: [anahtar],
        aciklama: "Amortisman gideri",
      },
      {
        taraf: "A",
        tutar: satir.tutar,
        rol: "AMORTISMAN",
        hesapKodu: birikmis,
        oneriKodu: birikmis,
        kaynak: "varsayilan",
        anahtarlar: [],
        aciklama: `Birikmiş amortisman · ${d.ad}`,
      },
    ],
  })
}
