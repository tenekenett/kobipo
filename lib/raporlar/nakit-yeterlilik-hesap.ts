/**
 * "NAKİT KAÇ GÜN YETER" — panodaki kartın ARİTMETİĞİ. Saf modül, Prisma yok.
 *
 * Soru: hiç tahsilat gelmese, bugünkü nakit son dönemin harcama hızıyla kaç gün
 * yeter? Veri `nakit-yeterlilik.ts`ten gelir; o da Nakit Akışı raporunun
 * hesabını (`computeCashFlow`) çağırır — kartın rakamı raporla aynı tanımdır:
 * nakit = kasa + banka + kredi kartı bakiyesi, çıkış = fatura ödemeleri +
 * faturasız giderler (virman hariç).
 *
 * Bilerek BRÜT çıkış: girişleri düşmek ("net yakım") tahsilatın süreceğini
 * varsayar; kart tam tersini sorar. Vadeli alacak ve borçlar nakit
 * projeksiyonunun işidir, kart oraya bağlanır.
 *
 * GÜN YAZILMAYAN durumlar — sayı yanıltırdı (canlı ölçüm, 2026-10-02):
 *   - Nakit sıfır ya da eksi: bölüm anlamsız. Canlıda kasa toplamı eksi duran
 *     firmalar var (−1,4 milyon TL); bu çoğu zaman girilmemiş tahsilattır.
 *   - Geçmiş kısa: 30 günden az kasa hareketi tek bir ödemeyi aylığa yayar.
 *   - Çıkış kaydı az: Kobipo'ya yalnız satış giren firmada 3,2 milyon TL nakit
 *     ve 90 günde tek 580 TL çıkış vardı — bölüm "1.300 yıl" derdi.
 */

/** Ortalamanın bakıldığı en uzun geçmiş (gün). */
export const PENCERE_GUN = 90
/** Ortalama için gereken en kısa kasa geçmişi (gün). */
export const EN_AZ_GOZLEM_GUN = 30
/** Ortalama için gereken en az çıkış hareketi. */
export const EN_AZ_CIKIS_ADEDI = 3
/** Bunun üstü "1 yıldan uzun" yazılır: o ufukta ortalama bir şey söylemez. */
export const UST_SINIR_GUN = 365

export type NakitYeterlilikGirdi = {
  /** Bugünkü kasa + banka + kredi kartı bakiyesi. */
  nakit: number
  /** `nakit`in içindeki kredi kartı bakiyesi (borç eksidir). */
  krediKarti: number
  /** Gözlem süresindeki toplam çıkış. */
  cikis: number
  /** Aynı süredeki toplam giriş — yalnız bilgi, hesaba girmez. */
  giris: number
  cikisAdedi: number
  /** Ortalamanın bölündüğü gün sayısı (pencere ya da ilk hareketten bugüne). */
  gozlemGun: number
}

export type NakitYeterlilikDurumu = "hesaplandi" | "nakit-yok" | "gecmis-kisa" | "cikis-az"

export type NakitYeterlilik = NakitYeterlilikGirdi & {
  durum: NakitYeterlilikDurumu
  /** Kaç gün yeter; yalnız `hesaplandi`da dolu. */
  gun: number | null
  /** `gun` üst sınırı aştı mı ("1 yıldan uzun"). */
  ustSinirdaAsti: boolean
  /** 30 günlük ortalama çıkış ve giriş. */
  aylikCikis: number
  aylikGiris: number
}

export function nakitYeterlilik(g: NakitYeterlilikGirdi): NakitYeterlilik {
  const gozlem = Math.max(g.gozlemGun, 0)
  const gunlukCikis = gozlem > 0 ? g.cikis / gozlem : 0
  const aylik = (toplam: number) => (gozlem > 0 ? (toplam / gozlem) * 30 : 0)
  const sonuc = (durum: NakitYeterlilikDurumu, gun: number | null = null): NakitYeterlilik => ({
    ...g,
    durum,
    gun,
    ustSinirdaAsti: gun != null && gun > UST_SINIR_GUN,
    aylikCikis: aylik(g.cikis),
    aylikGiris: aylik(g.giris),
  })

  if (g.nakit <= 0) return sonuc("nakit-yok")
  if (gozlem < EN_AZ_GOZLEM_GUN) return sonuc("gecmis-kisa")
  if (g.cikisAdedi < EN_AZ_CIKIS_ADEDI || gunlukCikis <= 0) return sonuc("cikis-az")
  return sonuc("hesaplandi", Math.floor(g.nakit / gunlukCikis))
}
