/**
 * K-BLG-07 · "KDV beyanına N gün kaldı; aktarılmamış faturalarınızdaki indirim
 * bu beyana girmeyecek."
 *
 * ── Kartın hesapladığı şey ve HESAPLAMADIĞI şey ─────────────────────────────
 * Kart bir BEYANNAME DEĞİL, beyan öncesi bir KONTROL LİSTESİDİR. Sistemdeki
 * belgelerden şunu çıkarır:
 *
 *   hesaplanan KDV  = dönemin satış faturalarındaki KDV (iade ters işaretle),
 *                     alıcının tevkif ettiği kısım düşülmüş
 *   indirilecek KDV = dönemin ALIŞ FATURASINA DÖNÜŞMÜŞ belgelerindeki KDV
 *   (ikisi de vergi raporunun `computeVatDeclaration`ından; hangi belgenin
 *   KDV'ye girdiği lib/raporlar/kdv-kural.ts'te — 2026-09-30'dan beri)
 *   kaçan indirim   = aynı döneme ait, kabul edilmiş ama AKTARILMAMIŞ gelen
 *                     faturalardaki KDV
 *
 * Sonuncusu kartın varlık sebebi: aktarılmamış fatura beyana girmez, yani o
 * KDV bu dönem indirilemez. K-BLG-01 aynı belgeleri sayıyor ama SÜREsiz bir
 * kuyruk olarak; bu kart onları BEYAN TAKVİMİNE bağlar — "sırada duruyor" ile
 * "bu ayın indirimi kaçıyor" farklı iki cümledir.
 *
 * HESAPLAMADIKLARI (kart bunu açıkça söyler): devreden KDV, istisna, KDV iadesi,
 * KDV-2, indirimli oran mahsubu. (Satıştaki tevkifat 2026-10-01'den beri
 * hesaplananda düşülü — vergi raporuyla aynı fonksiyon.) Bu yüzden çıkan sayı "ödenecek KDV"
 * değil, "bu belgelerden görünen fark"tır. Rakamı beyanname yerine koyan bir
 * cümle, kartın yapabileceği en zararlı şey olurdu.
 *
 * ── Takvim varsayımı ────────────────────────────────────────────────────────
 * Aylık KDV beyannamesi izleyen ayın 28'inde verilir ve ödenir (`BEYAN_GUNU`).
 * 28'i Cumartesi ya da Pazar'a düşerse süre izleyen Pazartesi biter (VUK md. 18:
 * süre resmî tatile rastlarsa tatili izleyen ilk iş günü; ör. 28 Temmuz 2024
 * Pazar → 29 Temmuz). Bayramlar ve GİB'in ek süre uzatmaları BİLİNMİYOR; tarih
 * bu yüzden ancak ERKEN gösterilebilir, geç değil — kartlar bunu yazar.
 * ÜÇ AYLIK beyan veren mükellef bu üründe ayırt edilemiyor — böyle bir alan yok
 * ve kart aylık varsayıyor. Yanlış olduğu hesapta kullanıcı kartı yok sayacak;
 * bu yüzden tarih kartın kendi cümlesinde açıkça yazılı, gizli varsayım değil.
 *
 * ── Pencere: son 12 gün ─────────────────────────────────────────────────────
 * Kart ayın başında değil, beyana `UYARI_PENCERESI_GUN` gün kala açılır. Ayın
 * 1'inde "28'ine beyan var" demek doğru ama aksiyon değil; son iki hafta,
 * aktarılmamış faturaların işlenebileceği gerçek penceredir.
 *
 * ── Ölçüm (2026-09-07, canlı) ──────────────────────────────────────────────
 * Ağustos 2026 dönemi için:
 *
 * | firma | hesaplanan | indirilecek | aktarılmamış |
 * |---|---|---|---|
 * | EREN FORKLİFT | ₺244.316 | ₺168.650 | 62 fatura · **₺24.727** |
 * | EREN F. PNÖMATİK | ₺244.693 | **₺0** | — |
 * | HİDROEREN | ₺0 | ₺0 | 63 fatura · **₺246.067** |
 * | REYPO BİLİŞİM | ₺6.478 | ₺0 | 2 fatura · ₺365 |
 *
 * İkinci satır kartın neden gerekli olduğunu tek başına anlatıyor: bir firma
 * ₺244.693 hesaplanan KDV'ye karşı SIFIR indirim beyan edecek durumda, çünkü
 * hiç alış faturası girilmemiş.
 *
 * ÇÖP KAYIT UYARISI: Haziran 2026'da tek bir firmada aktarılmamış KDV toplamı
 * ₺240 milyon çıkıyor (K-BLG-01'in penceresini koymasına sebep olan ₺24,5
 * milyarlık sahte kayıtlar). Kart bu yüzden toplamın yanına EN BÜYÜK TEK
 * FATURAYI da yazar: tek kayıt toplamı ele geçirdiğinde okuyan kişi bunu görür.
 */

import { aktarilmamisGelenFaturalar, computeVatDeclaration } from "@/lib/raporlar/vergiler"
import { siradakiBeyan } from "@/lib/raporlar/beyan-takvimi"

// Takvim saf modülde (vergi raporu sayfası istemcide de okuyor); eski içe
// aktarmalar için buradan da verilir.
export { BEYAN_GUNU, siradakiBeyan, type SiradakiBeyan } from "@/lib/raporlar/beyan-takvimi"

/** Beyana bu kadar gün kala kart açılır. */
export const UYARI_PENCERESI_GUN = 12

export type KdvDonemi = {
  /** "2026-08" — günlüğe de bu yazılır. */
  donem: string
  /** "Ağustos 2026" — karta yazılan ad. */
  donemAdi: string
  /** Beyana kalan gün (0 = bugün son gün). */
  kalanGun: number
  beyanTarihi: string
  hesaplananKdv: number
  indirilecekKdv: number
  /** Fark — "ödenecek KDV" DEĞİL (bkz. başlık). */
  fark: number
  satisAdet: number
  alisAdet: number
  /** Aynı döneme ait, kabul edilmiş ama aktarılmamış gelen fatura sayısı. */
  kacanAdet: number
  kacanKdv: number
  /** Aktarılmamışların içindeki en büyük tek KDV — çöp kayıt görünsün diye. */
  kacanEnBuyuk: number
}

export type BeyanPenceresi = {
  kalanGun: number
  donemBas: Date
  donemSon: Date
  donem: string
  donemAdi: string
  beyanTarihi: string
}

/**
 * Beyan penceresi — SAF fonksiyon, dışa açık çünkü TARAYICIDA SINANAMIYOR.
 *
 * Kart yalnız beyana `UYARI_PENCERESI_GUN` gün kala görünüyor; ölçüm günü
 * (7 Eylül) ekranda hiç çıkmadı. Takvim mantığının doğruluğu bu yüzden testle
 * korunuyor: yıl geçişi (Ocak → Aralık dönemi), son gün, hafta sonu kayması ve
 * pencere sınırları orada sınanıyor. Dönem ve son gün `siradakiBeyan`dan gelir:
 * pano kartı ile bu uyarı aynı takvimi okur.
 */
export function beyanPenceresi(simdi: Date = new Date()): BeyanPenceresi | null {
  const b = siradakiBeyan(simdi)

  // Sıra içinde bulunulan aya geçtiyse geçen ayın süresi dolmuştur ve bu ayınki
  // henüz aksiyon değil — kart susar.
  if (b.devamEdiyor || b.kalanGun > UYARI_PENCERESI_GUN) return null

  // Dönem sınırları UTC 00:00 ekseninde (kod tabanının her yerindeki eksen);
  // üst sınır DIŞLAYICI.
  return {
    kalanGun: b.kalanGun,
    donemBas: new Date(Date.UTC(b.yil, b.ay - 1, 1)),
    donemSon: new Date(Date.UTC(b.yil, b.ay, 1)),
    donem: b.donem,
    donemAdi: b.donemAdi,
    beyanTarihi: b.beyanTarihi,
  }
}

export async function kdvDonemiOzeti(
  companyId: string,
  simdi: Date = new Date()
): Promise<KdvDonemi | null> {
  const pencere = beyanPenceresi(simdi)
  if (!pencere) return null
  const { kalanGun, donemBas, donemSon, donem, donemAdi } = pencere

  // Hesaplanan ve indirilecek KDV VERGİ RAPORUNUN fonksiyonundan: hangi belgenin
  // KDV'ye girdiği tek yerde (lib/raporlar/kdv-kural.ts). Kartın kendi sorgusu
  // vardı ve yalnız GÖNDERİLMİŞ satışı sayıyordu; matbu faturalar ve fişler hep
  // taslakta kaldığı için kart onların KDV'sini hiç görmüyordu.
  const [beyanname, kacan] = await Promise.all([
    computeVatDeclaration({
      companyId,
      year: donemBas.getUTCFullYear(),
      month: donemBas.getUTCMonth() + 1,
    }),
    // Vergi raporunun "aktarılmamış gelen fatura" uyarısıyla AYNI sorgu.
    aktarilmamisGelenFaturalar({ companyId, bas: donemBas, sonHaric: donemSon }),
  ])

  const hesaplananKdv = beyanname.calculatedVAT
  const indirilecekKdv = beyanname.deductibleVAT
  const satisAdet = beyanname.documentCounts.sales
  const alisAdet = beyanname.documentCounts.purchases
  const kacanAdet = kacan.adet
  const kacanKdv = kacan.kdv

  // Dönemde hiç hareket yoksa beyan hatırlatması gürültüdür.
  if (satisAdet === 0 && alisAdet === 0 && kacanAdet === 0) return null

  return {
    donem,
    donemAdi,
    kalanGun,
    beyanTarihi: pencere.beyanTarihi,
    hesaplananKdv,
    indirilecekKdv,
    fark: hesaplananKdv - indirilecekKdv,
    satisAdet,
    alisAdet,
    kacanAdet,
    kacanKdv,
    kacanEnBuyuk: kacan.enBuyuk,
  }
}
