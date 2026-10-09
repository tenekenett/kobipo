/**
 * MUHASEBE ÖZETİ — "ne yapmam gerekiyor?" listesi. Saf modül; sayılar
 * `ozet.server.ts`ten gelir, ekran `/muhasebe/ozet`.
 *
 * Muhasebeci olmayan kullanıcı için yazılır: her adım düz bir cümle, durum
 * (bitti / yapılacak / bilgi) ve tek bir "şimdi bunu yap" bağlantısıdır. Sıra
 * defterin doğal akışıdır: açılış → hesap seçimi → onay → belge değişiklikleri
 * → aylık işler → yıl sonu.
 */

export type AdimDurumu = "tamam" | "yapilacak" | "uyari" | "bilgi"

export type OzetAdimi = {
  anahtar: string
  durum: AdimDurumu
  baslik: string
  aciklama: string
  /** Panel içi bağlantı (`?company=` istemcide eklenir). */
  href?: string
  eylem?: string
}

export type OzetSayilari = {
  /** Taslak + motor emin: toplu onaya hazır. */
  emin: number
  /** Taslak + emin değil: hesap seçimi / gözden geçirme bekliyor. */
  gozden: number
  /** Onaylı fişin belgesi sonradan değişti. */
  degisti: number
  onayli: number
  /** Taslaklarda hesabı seçilmemiş satır sayısı. */
  hesapsizSatir: number
  /** En eski bekleyen (taslak) fişin günü, "YYYY-AA-GG". */
  enEskiTaslak: string | null
  acilis: { durum: "DRAFT" | "POSTED"; emin: boolean; degisti: boolean } | null
  /** Başlangıçta Kobipo'da bakiye var mıydı (yoksa açılış fişi kendiliğinden doğmaz). */
  baslangicBakiyesiVar: boolean
  /** Defterin kapsadığı, kapanışı yapılmamış GEÇMİŞ yıllar (en eskisi önce). */
  kapanmamisYillar: number[]
  /** KDV mahsubu yapılmamış (ya da güncel olmayan) geçmiş aylar ("YYYY-AA"). */
  kdvMahsupBekleyen: string[]
  /** Satılan malın maliyeti yazılmamış (ya da güncel olmayan) geçmiş aylar; stok takibi yoksa boş. */
  smmBekleyen?: string[]
}

export function ozetAdimlari(s: OzetSayilari): OzetAdimi[] {
  const adimlar: OzetAdimi[] = []

  // 1. Açılış
  if (s.acilis) {
    const onayli = s.acilis.durum === "POSTED"
    adimlar.push({
      anahtar: "acilis",
      durum: s.acilis.degisti ? "uyari" : onayli ? "tamam" : "yapilacak",
      baslik: onayli ? "Açılış fişi onaylandı" : "Açılış fişini gözden geçirin",
      aciklama: s.acilis.degisti
        ? "Başlangıçtan önceki bir kayıt sonradan değişti; açılış fişi yeniden üretilmeli."
        : onayli
          ? "Defterin başladığı gündeki bakiyeler deftere işlendi."
          : "Defterin başladığı gündeki müşteri, tedarikçi, kasa ve banka bakiyeleri. Kobipo'da tutulmayan kalemler (sermaye, stok, demirbaş) tek bir fark satırında durur; muhasebecinizle dağıtıp onaylayın.",
      href: "/muhasebe/ayarlar",
      eylem: onayli ? undefined : "Açılış fişine git",
    })
  } else {
    adimlar.push({
      anahtar: "acilis",
      durum: "bilgi",
      baslik: "Açılış fişi yok",
      aciklama: s.baslangicBakiyesiVar
        ? "Açılış fişi henüz kurulmadı; Fişler ekranı açıldığında kurulur."
        : "Başlangıç tarihinde Kobipo'da bakiye yoktu. Sermaye, demirbaş, stok ya da kredi gibi açılış kalemleriniz varsa muhasebeciniz açılış fişini elle girebilir.",
      href: "/muhasebe/ayarlar",
      eylem: "Muhasebe ayarları",
    })
  }

  // 2. Hesap seçimi bekleyenler
  adimlar.push(
    s.gozden > 0
      ? {
          anahtar: "gozden",
          durum: "yapilacak",
          baslik: `${s.gozden} fiş hesap seçimi bekliyor`,
          aciklama:
            s.hesapsizSatir > 0
              ? `${s.hesapsizSatir} satırda hangi hesaba yazılacağı belli değil (ör. bir gider kira mı, elektrik mi). Aynı türden fişleri tek seferde eşleyebilirsiniz; seçiminiz sonraki benzer belgelerde hatırlanır.`
              : "Bu fişlerde Kobipo hesabı tahmin etti (ör. alışı gider saydı); doğru olduğunu kontrol edip onaylayın.",
          href: "/muhasebe/fisler/eslesme",
          eylem: "Toplu eşle",
        }
      : {
          anahtar: "gozden",
          durum: "tamam",
          baslik: "Hesap seçimi bekleyen fiş yok",
          aciklama: "Bütün fişlerin hesapları belli.",
        },
  )

  // 3. Onay
  adimlar.push(
    s.emin > 0
      ? {
          anahtar: "emin",
          durum: "yapilacak",
          baslik: `${s.emin} fiş onaya hazır`,
          aciklama:
            "Hesapları belli, tahmin içermeyen fişler. Onaylayınca deftere (yevmiye, mizan, bilanço) işlenir; gerekirse sonradan geri alınabilir.",
          href: "/muhasebe/fisler",
          eylem: "Fişleri onayla",
        }
      : {
          anahtar: "emin",
          durum: s.gozden > 0 ? "bilgi" : "tamam",
          baslik: s.gozden > 0 ? "Onaya hazır fiş yok" : "Bütün fişler onaylandı",
          aciklama:
            s.gozden > 0
              ? "Önce hesap seçimi bekleyen fişleri tamamlayın; hesapları belli olunca onaya hazır olurlar."
              : `Deftere işlenmiş ${s.onayli} fiş var.`,
        },
  )

  // 4. Belge değişti
  if (s.degisti > 0) {
    adimlar.push({
      anahtar: "degisti",
      durum: "uyari",
      baslik: `${s.degisti} onaylı fişin belgesi değişti`,
      aciklama:
        "Bu fişler onaylandıktan sonra belgeleri değişti (tutar, tarih, iptal…). Defterde eski hâlleri duruyor; fişi açıp yeniden üretin ve tekrar onaylayın.",
      href: "/muhasebe/fisler?sekme=degisti",
      eylem: "Değişen fişler",
    })
  }

  // 5. Ay sonu: önce satılan malın maliyeti, sonra KDV mahsubu
  const smm = s.smmBekleyen ?? []
  if (smm.length > 0) {
    adimlar.push({
      anahtar: "smm",
      durum: "yapilacak",
      baslik: smm.length === 1 ? `${ayAdi(smm[0])} satılan malın maliyeti bekliyor` : `${smm.length} ayın satılan malın maliyeti bekliyor`,
      aciklama:
        "Ay sonunda elinizdeki stok değerlenir; aldığınız ama sattığınız malların maliyeti gider olur. Yapılmazsa kâr olduğundan yüksek görünür. Kobipo stok kayıtlarınızdan hesaplar, siz onaylarsınız.",
      href: "/muhasebe/ay-sonu",
      eylem: "Ay sonu işlemleri",
    })
  }
  if (s.kdvMahsupBekleyen.length > 0) {
    const n = s.kdvMahsupBekleyen.length
    adimlar.push({
      anahtar: "kdv",
      durum: "yapilacak",
      baslik: n === 1 ? `${ayAdi(s.kdvMahsupBekleyen[0])} KDV mahsubu bekliyor` : `${n} ayın KDV mahsubu bekliyor`,
      aciklama:
        "Her ay sonunda satışlarda hesaplanan KDV ile alışlarda ödenen KDV karşılaştırılır: fark ödenecekse vergi borcuna, fazlaysa devreden KDV'ye aktarılır. Kobipo fişi hazırlar, siz onaylarsınız.",
      href: "/muhasebe/ay-sonu?sekme=kdv",
      eylem: "KDV mahsubu",
    })
  }

  // 6. Yıl sonu
  for (const yil of s.kapanmamisYillar) {
    adimlar.push({
      anahtar: `kapanis-${yil}`,
      durum: "yapilacak",
      baslik: `${yil} yılı kapanmadı`,
      aciklama: `${yil} yılının gelir ve giderleri kâra/zarara aktarılıp yıl kilitlenmeli. Önce o yılın bütün fişleri onaylanmış olmalı.`,
      href: "/muhasebe/ayarlar",
      eylem: "Dönem kapanışı",
    })
  }
  return adimlar
}

const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]

/** "2026-09" → "Eylül 2026". */
export function ayAdi(ay: string): string {
  const [y, m] = ay.split("-").map(Number)
  return `${AYLAR[m - 1] ?? ay} ${y}`
}
