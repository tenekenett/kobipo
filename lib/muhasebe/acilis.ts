/**
 * AÇILIŞ FİŞİ — başlangıç tarihindeki bilinen bakiyeler. Saf modül.
 *
 * Fiş üretimi seçilen başlangıç tarihinden başlar (karar 2026-10-02); öncesindeki
 * her şey tek bir açılış fişiyle girer. Kaynaklar bilançoyla AYNIDIR (tarih
 * itibarıyla, sınır dışlayıcı):
 *
 *   cari bakiyeleri        lib/cari/bakiye-asof.ts          → 120 / 320 cari alt hesabı
 *   kasa / banka / kart    bakiye − sınırdan sonraki hareket → 100 / 102 / 309 alt hesabı
 *   portföydeki çek/senet  lib/raporlar/bilanco-kiymet.ts   → 101 · 121 (alınan) / 103 · 321 (verilen)
 *   personel masraf defteri lib/personel/masraf-defteri.ts  → 335 personel alt hesabı
 *
 * Stok, demirbaş, sermaye, kredi Kobipo'da tutulmuyor: aradaki fark tek bir
 * HESAPSIZ satırda durur (öneri 500 Sermaye) ve müşavir onu dağıtır — elle satır
 * ekleyerek (153 stok, 255 demirbaş, 500 sermaye…). Fark satırı kapanmadan fiş
 * onaylanamaz; sessizce 500'e yazmak açılış bilançosunu uydurmak olurdu.
 *
 * Bakiyenin işareti satırın tarafını belirler: müşteri + → borç (alacağımız),
 * müşteri − → alacak (avans); tedarikçide tersi. Cari alt hesabı ters bakiyede
 * de kendi hesabında kalır — mizan ↔ cari bakiyesi eşitliği böyle korunur, bilanço
 * ayrımı cari başına yapılır (alınan/verilen avans).
 */

import { fisKur, num, r2, type FisSatiri, type HazirFis } from "@/lib/muhasebe/fis"

export type AcilisGirdisi = {
  tarih: Date
  /** + = bize borçlu. */
  musteriler: Array<{ id: string; ad: string; bakiye: number }>
  /** + = biz borçluyuz. */
  tedarikciler: Array<{ id: string; ad: string; bakiye: number }>
  /** Hesabın kendi bakiyesi (kartta harcama eksi). */
  finans: Array<{ id: string; ad: string; tur: string; bakiye: number }>
  kiymet: { alinanCek: number; verilenCek: number; alinanSenet: number; verilenSenet: number }
  /** + = firma çalışana borçlu. */
  personel: Array<{ id: string; ad: string; bakiye: number }>
}

export const ACILIS_FARK_ACIKLAMASI = "Açılış farkı — dağıtılacak (sermaye, stok, demirbaş…)"

export function acilisFisi(g: AcilisGirdisi): HazirFis {
  const satirlar: FisSatiri[] = []
  const ekle = (s: FisSatiri) => {
    if (r2(s.tutar) !== 0) satirlar.push(s)
  }

  for (const m of g.musteriler) {
    ekle({
      taraf: "B",
      tutar: r2(num(m.bakiye)),
      rol: "ACILIS",
      hesapKodu: null,
      oneriKodu: "120",
      kaynak: "cari",
      anahtarlar: [],
      aciklama: m.ad,
      alt: { tur: "musteri", id: m.id, ad: m.ad },
    })
  }
  for (const t of g.tedarikciler) {
    ekle({
      taraf: "A",
      tutar: r2(num(t.bakiye)),
      rol: "ACILIS",
      hesapKodu: null,
      oneriKodu: "320",
      kaynak: "cari",
      anahtarlar: [],
      aciklama: t.ad,
      alt: { tur: "tedarikci", id: t.id, ad: t.ad },
    })
  }
  for (const f of g.finans) {
    const oneri = f.tur === "CASH" ? "100" : f.tur === "CREDIT_CARD" ? "309" : "102"
    ekle({
      taraf: "B",
      tutar: r2(num(f.bakiye)),
      rol: "ACILIS",
      hesapKodu: null,
      oneriKodu: oneri,
      kaynak: "cari",
      anahtarlar: [],
      aciklama: f.ad,
      alt: { tur: "finans", id: f.id, ad: f.ad, altTur: f.tur },
    })
  }
  const kiymet: Array<[number, "B" | "A", string, string]> = [
    [g.kiymet.alinanCek, "B", "101", "Portföydeki alınan çekler"],
    [g.kiymet.alinanSenet, "B", "121", "Portföydeki alacak senetleri"],
    [g.kiymet.verilenCek, "A", "103", "Ödenmemiş verilen çekler"],
    [g.kiymet.verilenSenet, "A", "321", "Ödenmemiş borç senetleri"],
  ]
  for (const [tutar, taraf, kod, aciklama] of kiymet) {
    ekle({ taraf, tutar: r2(num(tutar)), rol: "ACILIS", hesapKodu: kod, oneriKodu: kod, kaynak: "varsayilan", anahtarlar: [], aciklama })
  }
  for (const p of g.personel) {
    ekle({
      taraf: "A",
      tutar: r2(num(p.bakiye)),
      rol: "ACILIS",
      hesapKodu: null,
      oneriKodu: "335",
      kaynak: "cari",
      anahtarlar: [],
      aciklama: p.ad,
      alt: { tur: "personel", id: p.id, ad: p.ad },
    })
  }

  const fark = acilisFarki(satirlar)
  if (fark) satirlar.push(fark)

  return fisKur({ tarih: g.tarih, aciklama: "Açılış fişi", tur: "ACILIS", satirlar })
}

/**
 * Satırları dengeleyen HESAPSIZ fark satırı (yoksa null). Elle eklenen satırlar
 * da hesaba katılır: müşavir farkı dağıttıkça satır küçülür, sıfırlanınca kalkar.
 * Eksi tutarlı satır karşı taraf sayılır (`fisKur` ile aynı).
 */
export function acilisFarki(satirlar: Array<Pick<FisSatiri, "taraf" | "tutar" | "rol">>): FisSatiri | null {
  let net = 0
  for (const s of satirlar) {
    if (s.rol === "ACILIS_FARK") continue
    net += s.taraf === "B" ? s.tutar : -s.tutar
  }
  net = r2(net)
  if (net === 0) return null
  return {
    // Borç fazlası (varlık > kaynak) öz kaynaktır → alacağa.
    taraf: net > 0 ? "A" : "B",
    tutar: Math.abs(net),
    rol: "ACILIS_FARK",
    hesapKodu: null,
    oneriKodu: "500",
    kaynak: "yok",
    anahtarlar: [],
    aciklama: ACILIS_FARK_ACIKLAMASI,
  }
}
