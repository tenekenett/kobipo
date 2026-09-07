/**
 * K-BLG-07 · "KDV beyanına N gün kaldı; aktarılmamış faturalarınızdaki indirim
 * bu beyana girmeyecek."
 *
 * ── Kartın hesapladığı şey ve HESAPLAMADIĞI şey ─────────────────────────────
 * Kart bir BEYANNAME DEĞİL, beyan öncesi bir KONTROL LİSTESİDİR. Sistemdeki
 * belgelerden şunu çıkarır:
 *
 *   hesaplanan KDV  = dönemin satış faturalarındaki KDV (iade ters işaretle)
 *   indirilecek KDV = dönemin ALIŞ FATURASINA DÖNÜŞMÜŞ belgelerindeki KDV
 *   kaçan indirim   = aynı döneme ait, kabul edilmiş ama AKTARILMAMIŞ gelen
 *                     faturalardaki KDV
 *
 * Sonuncusu kartın varlık sebebi: aktarılmamış fatura beyana girmez, yani o
 * KDV bu dönem indirilemez. K-BLG-01 aynı belgeleri sayıyor ama SÜREsiz bir
 * kuyruk olarak; bu kart onları BEYAN TAKVİMİNE bağlar — "sırada duruyor" ile
 * "bu ayın indirimi kaçıyor" farklı iki cümledir.
 *
 * HESAPLAMADIKLARI (kart bunu açıkça söyler): devreden KDV, tevkifat, istisna,
 * iade, KDV-2, indirimli oran mahsubu. Bu yüzden çıkan sayı "ödenecek KDV"
 * değil, "bu belgelerden görünen fark"tır. Rakamı beyanname yerine koyan bir
 * cümle, kartın yapabileceği en zararlı şey olurdu.
 *
 * ── Takvim varsayımı ────────────────────────────────────────────────────────
 * Aylık KDV beyannamesi izleyen ayın 28'inde verilir ve ödenir (`BEYAN_GUNU`).
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

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { sayi } from "@/lib/asistan/veri/temel"

/** Aylık KDV beyannamesinin verilme/ödeme günü (izleyen ay). */
export const BEYAN_GUNU = 28

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

const AY_ADLARI = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
]

/** İstanbul takvimine göre bugünün yıl/ay/gün üçlüsü. */
function istanbulParcalari(simdi: Date): { yil: number; ay: number; gun: number } {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(simdi)
  const [yil, ay, gun] = s.split("-").map(Number)
  return { yil, ay, gun }
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
 * Kart yalnız ayın 16–28'i arasında görünüyor; ölçüm günü (7 Eylül) ekranda
 * hiç çıkmadı. Takvim mantığının doğruluğu bu yüzden testle korunuyor: yıl
 * geçişi (Ocak → Aralık dönemi), son gün (28) ve pencere sınırları orada
 * sınanıyor. Kart kodunun geri kalanı bu üçlüyü hazır alıyor.
 */
export function beyanPenceresi(simdi: Date = new Date()): BeyanPenceresi | null {
  const { yil, ay, gun } = istanbulParcalari(simdi)

  // Beyan bu ayın 28'inde; konusu GEÇEN aydır. 28'i geçtiyse o dönemin süresi
  // dolmuştur ve gelecek ayınki henüz aksiyon değil — kart susar.
  const kalanGun = BEYAN_GUNU - gun
  if (kalanGun < 0 || kalanGun > UYARI_PENCERESI_GUN) return null

  // Geçen ayın sınırları (UTC 00:00 ekseni — kod tabanının her yerindeki eksen).
  // `Date.UTC(yil, -1, 1)` Ocak'ta geçen yılın Aralık'ına düşer; ay/yıl taşmasını
  // elle hesaplamak yerine Date'e bırakmak bu yüzden bilinçli.
  const donemBas = new Date(Date.UTC(yil, ay - 2, 1))
  const donemSon = new Date(Date.UTC(yil, ay - 1, 1))
  const beyan = new Date(Date.UTC(yil, ay - 1, BEYAN_GUNU))

  return {
    kalanGun,
    donemBas,
    donemSon,
    donem: `${donemBas.getUTCFullYear()}-${String(donemBas.getUTCMonth() + 1).padStart(2, "0")}`,
    donemAdi: `${AY_ADLARI[donemBas.getUTCMonth()]} ${donemBas.getUTCFullYear()}`,
    beyanTarihi: new Intl.DateTimeFormat("tr-TR", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    }).format(beyan),
  }
}

export async function kdvDonemiOzeti(
  companyId: string,
  simdi: Date = new Date()
): Promise<KdvDonemi | null> {
  const pencere = beyanPenceresi(simdi)
  if (!pencere) return null
  const { kalanGun, donemBas, donemSon, donem, donemAdi } = pencere

  const [satis, alis, kacan] = await Promise.all([
    prisma.$queryRaw<Array<{ kdv: unknown; adet: bigint }>>(Prisma.sql`
      SELECT COALESCE(SUM(CASE WHEN i.type = 'RETURN' THEN -i."vatAmount"
                               ELSE i."vatAmount" END), 0) AS kdv,
             COUNT(*) AS adet
      FROM invoices i
      WHERE i."companyId" = ${companyId}
        AND (i.type = 'SALES'
             OR (i.type = 'RETURN' AND COALESCE(i."returnKind", 'SALES') <> 'PURCHASE'))
        -- Beyana yalnız KESİLMİŞ belge girer: taslak fatura henüz yoktur.
        AND i.status = 'SENT'
        AND COALESCE(i.currency, 'TRY') = 'TRY'
        AND i.date >= ${donemBas} AND i.date < ${donemSon}
    `),
    prisma.$queryRaw<Array<{ kdv: unknown; adet: bigint }>>(Prisma.sql`
      SELECT COALESCE(SUM(CASE WHEN i.type = 'RETURN' THEN -i."vatAmount"
                               ELSE i."vatAmount" END), 0) AS kdv,
             COUNT(*) AS adet
      FROM invoices i
      WHERE i."companyId" = ${companyId}
        AND (i.type = 'PURCHASE'
             OR (i.type = 'RETURN' AND COALESCE(i."returnKind", 'SALES') = 'PURCHASE'))
        AND i.status NOT IN ('CANCELLED', 'CONVERTED')
        AND COALESCE(i.currency, 'TRY') = 'TRY'
        AND i.date >= ${donemBas} AND i.date < ${donemSon}
    `),
    prisma.$queryRaw<Array<{ kdv: unknown; adet: bigint; en_buyuk: unknown }>>(Prisma.sql`
      SELECT COALESCE(SUM(ii."vatAmount"), 0) AS kdv,
             COUNT(*) AS adet,
             COALESCE(MAX(ii."vatAmount"), 0) AS en_buyuk
      FROM incoming_invoices ii
      WHERE ii."companyId" = ${companyId}
        AND ii.status = 'KABUL'
        AND ii."isLinkedToPurchase" = false
        AND ii."isArchived" = false
        AND COALESCE(ii."currencyCode", 'TRY') = 'TRY'
        AND ii."docDate" >= ${donemBas} AND ii."docDate" < ${donemSon}
    `),
  ])

  const hesaplananKdv = sayi(satis[0]?.kdv)
  const indirilecekKdv = sayi(alis[0]?.kdv)
  const satisAdet = Number(satis[0]?.adet ?? 0)
  const alisAdet = Number(alis[0]?.adet ?? 0)
  const kacanAdet = Number(kacan[0]?.adet ?? 0)
  const kacanKdv = sayi(kacan[0]?.kdv)

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
    kacanEnBuyuk: sayi(kacan[0]?.en_buyuk),
  }
}
