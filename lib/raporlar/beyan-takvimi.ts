/**
 * Beyan takvimi — SAF (Prisma yok; vergi raporu sayfası istemcide de okur).
 *
 * Aylık beyannamelerin son günü İZLEYEN AYIN sabit bir günüdür:
 *
 *   KDV (1 ve 2 No.lu)                 → 28'i  (`BEYAN_GUNU`, 1.12.2022'den beri)
 *   Muhtasar ve Prim Hizmet (MPHB)     → 26'sı (`MUHTASAR_GUNU`)
 *
 * Son gün Cumartesi ya da Pazar'a düşerse süre izleyen Pazartesi biter (VUK
 * md. 18: süre resmî tatile rastlarsa tatili izleyen ilk iş günü; ör. 28 Temmuz
 * 2024 Pazar → 29 Temmuz). Bayramlar ve GİB'in ek süre uzatmaları BİLİNMİYOR;
 * tarih bu yüzden ancak ERKEN gösterilebilir, geç değil — ekranlar bunu yazar.
 * Üç aylık beyan veren mükellef ayırt edilemiyor; aylık varsayılır.
 */

/** Aylık KDV beyannamesinin verilme/ödeme günü (izleyen ay). */
export const BEYAN_GUNU = 28

/** Muhtasar ve Prim Hizmet Beyannamesinin verilme/ödeme günü (izleyen ay). */
export const MUHTASAR_GUNU = 26

export const AY_ADLARI = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
]

/** İstanbul takvimine göre bugünün yıl/ay/gün üçlüsü. */
export function istanbulParcalari(simdi: Date): { yil: number; ay: number; gun: number } {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(simdi)
  const [yil, ay, gun] = s.split("-").map(Number)
  return { yil, ay, gun }
}

/**
 * Bir dönemin (yıl, ay 1–12) beyan son günü: izleyen ayın `gun`ü, hafta
 * sonuysa Pazartesi. Dönen tarih UTC gece yarısıdır (takvim günü ekseni).
 */
export function beyanSonGunu(
  yil: number,
  ay: number,
  gun: number = BEYAN_GUNU,
): { tarih: Date; kaydirildi: boolean } {
  // Ay/yıl taşmasını Date'e bırak: Aralık dönemi gelecek yılın Ocak'ına düşer.
  const tarih = new Date(Date.UTC(yil, ay, gun))
  const haftaGunu = tarih.getUTCDay() // 0 = Pazar, 6 = Cumartesi
  const ileri = haftaGunu === 6 ? 2 : haftaGunu === 0 ? 1 : 0
  if (ileri === 0) return { tarih, kaydirildi: false }
  return { tarih: new Date(tarih.getTime() + ileri * 864e5), kaydirildi: true }
}

const gunAy = (t: Date) =>
  new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", timeZone: "UTC" }).format(t)
const haftaGunuAdi = (t: Date) =>
  new Intl.DateTimeFormat("tr-TR", { weekday: "long", timeZone: "UTC" }).format(t)

export type BeyanTarihi = {
  /** "28 Ekim" */
  tarih: string
  /** "Çarşamba" */
  haftaGunu: string
  /** Son gün hafta sonundan Pazartesi'ye kaydı. */
  kaydirildi: boolean
  /** Bugünden son güne kalan gün; 0 = bugün son gün, eksi = süre geçti. */
  kalanGun: number
}

/** Seçilen bir dönemin son günü ve bugüne göre durumu — vergi raporu sayfası. */
export function beyanTarihi(
  yil: number,
  ay: number,
  gun: number,
  simdi: Date = new Date(),
): BeyanTarihi {
  const { tarih, kaydirildi } = beyanSonGunu(yil, ay, gun)
  const b = istanbulParcalari(simdi)
  const bugun = Date.UTC(b.yil, b.ay - 1, b.gun)
  return {
    tarih: gunAy(tarih),
    haftaGunu: haftaGunuAdi(tarih),
    kaydirildi,
    kalanGun: Math.round((tarih.getTime() - bugun) / 864e5),
  }
}

export type SiradakiBeyan = {
  /** Beyana konu dönemin yılı ve ayı (1–12). */
  yil: number
  ay: number
  /** "2026-09" */
  donem: string
  /** "Eylül 2026" */
  donemAdi: string
  /** "28 Ekim" — 28'i hafta sonuysa kaymış hâli ("30 Kasım"). */
  beyanTarihi: string
  /** 28'i hafta sonuna düştü; son gün izleyen Pazartesi. */
  kaydirildi: boolean
  /** Beyana kalan gün (0 = bugün son gün). */
  kalanGun: number
  /** Dönem henüz kapanmadı: rakam ay sonuna kadar değişir. */
  devamEdiyor: boolean
  /** İçinde bulunulan ay — dönem geçen aysa ikinci satır olarak gösterilir. */
  buAy: { yil: number; ay: number; adi: string }
}

/**
 * SIRADAKİ KDV beyanı — panodaki KDV kartının ve K-BLG-07 penceresinin dönemi.
 *
 * Sıradaki dönem, son günü bugün ya da sonra olan EN ESKİ dönemdir: ayın
 * 28'ine kadar geçen ay, sonra içinde bulunulan ay. Hafta sonu kayması sınırı
 * en çok iki gün öteler — ama 28 Şubat hafta sonuysa Ocak'ın son günü Mart'a
 * taşar; arama bu yüzden iki ay geriden başlar.
 */
export function siradakiBeyan(simdi: Date = new Date()): SiradakiBeyan {
  const { yil, ay, gun } = istanbulParcalari(simdi)
  const bugun = Date.UTC(yil, ay - 1, gun)

  // Dönemin ilk günü; ay/yıl taşmasını Date'e bırak (`Date.UTC(yil, -1, 1)`
  // geçen yılın Aralık'ıdır). geri = 0 (içinde bulunulan ay) her zaman uyar:
  // son günü gelecek aydadır.
  const donemOf = (geri: number) => new Date(Date.UTC(yil, ay - 1 - geri, 1))
  const sonOf = (d: Date) => beyanSonGunu(d.getUTCFullYear(), d.getUTCMonth() + 1, BEYAN_GUNU)

  let geri = 2
  let donemBas = donemOf(geri)
  let son = sonOf(donemBas)
  while (geri > 0 && son.tarih.getTime() < bugun) {
    geri -= 1
    donemBas = donemOf(geri)
    son = sonOf(donemBas)
  }

  return {
    yil: donemBas.getUTCFullYear(),
    ay: donemBas.getUTCMonth() + 1,
    donem: `${donemBas.getUTCFullYear()}-${String(donemBas.getUTCMonth() + 1).padStart(2, "0")}`,
    donemAdi: `${AY_ADLARI[donemBas.getUTCMonth()]} ${donemBas.getUTCFullYear()}`,
    beyanTarihi: gunAy(son.tarih),
    kaydirildi: son.kaydirildi,
    kalanGun: Math.round((son.tarih.getTime() - bugun) / 864e5),
    devamEdiyor: geri === 0,
    buAy: { yil, ay, adi: `${AY_ADLARI[ay - 1]} ${yil}` },
  }
}
