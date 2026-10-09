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
 *   açık personel avansı    lib/personel/avans.server.ts     → 196 (bordro mahsubuyla aynı hesap)
 *   kredi / ortak hareketi  Transaction.purpose LOAN/PARTNER → 300 · 331 / 131 (hareket-turu.ts)
 *   demirbaşlar             FixedAsset (başlangıçtan önce alınan) → 25x/26x maliyet · 257/268 birikmiş
 *   stok                    Kobipo stok defteri (miktar × AVCO, stok-maliyeti.server.ts) → 153
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
  /** Açık personel avansı — + = çalışan firmaya borçlu (verilmiş, bordrodan düşülmemiş). */
  avanslar?: Array<{ id: string; ad: string; bakiye: number }>
  /** Kullanılan − ödenen kredi anaparası (+ = borç). */
  krediler?: number
  /** Ortaktan gelen − ortağa ödenen (+ = ortağa borç, − = ortaktan alacak). */
  ortak?: number
  /** Başlangıçtan önce alınmış, elden çıkarılmamış demirbaşlar (Muhasebe → Demirbaşlar). */
  demirbaslar?: Array<{ ad: string; hesapKodu: string; maliyet: number; birikmis: number }>
  /** Başlangıçtaki ticari mal stoğunun değeri (aylık maliyet hesabıyla aynı değerleme). */
  stok?: number
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

  for (const a of g.avanslar ?? []) {
    ekle({
      taraf: "B",
      tutar: r2(num(a.bakiye)),
      rol: "ACILIS",
      hesapKodu: "196",
      oneriKodu: "196",
      kaynak: "varsayilan",
      anahtarlar: [],
      aciklama: `Personel avansı · ${a.ad}`,
    })
  }

  const kredi = r2(num(g.krediler))
  if (kredi !== 0) {
    ekle({ taraf: "A", tutar: kredi, rol: "ACILIS", hesapKodu: "300", oneriKodu: "300", kaynak: "varsayilan", anahtarlar: [], aciklama: "Banka kredileri (kullanılan − ödenen)" })
  }
  const ortak = r2(num(g.ortak))
  if (ortak !== 0) {
    const borc = ortak > 0
    ekle({
      taraf: borc ? "A" : "B",
      tutar: Math.abs(ortak),
      rol: "ACILIS",
      hesapKodu: borc ? "331" : "131",
      oneriKodu: borc ? "331" : "131",
      kaynak: "varsayilan",
      anahtarlar: [],
      aciklama: borc ? "Ortaklara borçlar" : "Ortaklardan alacaklar",
    })
  }

  const stok = r2(num(g.stok))
  if (stok > 0) {
    ekle({ taraf: "B", tutar: stok, rol: "ACILIS", hesapKodu: "153", oneriKodu: "153", kaynak: "varsayilan", anahtarlar: [], aciklama: "Başlangıçtaki stok (Kobipo stok kayıtlarından)" })
  }
  for (const d of g.demirbaslar ?? []) {
    ekle({ taraf: "B", tutar: r2(num(d.maliyet)), rol: "ACILIS", hesapKodu: d.hesapKodu, oneriKodu: d.hesapKodu.split(".")[0], kaynak: "varsayilan", anahtarlar: [], aciklama: d.ad })
    const birikmis = d.hesapKodu.split(".")[0].startsWith("26") ? "268" : "257"
    ekle({ taraf: "A", tutar: r2(num(d.birikmis)), rol: "ACILIS", hesapKodu: birikmis, oneriKodu: birikmis, kaynak: "varsayilan", anahtarlar: [], aciklama: `Birikmiş amortisman · ${d.ad}` })
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
