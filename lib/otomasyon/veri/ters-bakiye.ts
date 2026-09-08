/**
 * K-THS-08 · "Müşteriden alınan paranın karşılığında fatura yok."
 * K-TDR-05 · "Tedarikçiye, borcunuzdan fazla ödeme yapılmış."
 *
 * İki kart, tek veri modülü: soru ikisinde de AYNI — cari bakiye ters yöne
 * dönmüş. Müşteri bize borçlu olmalıyken biz ona borçlu görünüyoruz (ya da
 * tersi). Formül aynı olduğu için iki kopya yazmak, bir gün birinin süzgeci
 * düzeltilip diğerinin unutulması demekti; kartlar `yon` ile ayrılıyor.
 *
 * ── Kartın söylediği "sonuç" ────────────────────────────────────────────────
 * Ters bakiyenin iki meşru okuması var ve kart İKİSİNİ DE söyler, birini
 * seçmez:
 *   1. AVANS — para peşin alınmış/verilmiş, malı veya hizmeti henüz yok. O
 *      hâlde bu tutar gelir değil BORÇTUR ve raporda öyle durmalıdır.
 *   2. FATURASI KESİLMEMİŞ İŞ — satış olmuş, para tahsil edilmiş, belge yok.
 *      Bu hâlde ciro ve KDV kayıtlarda eksiktir (K-BLG-01/04'ün aynası:
 *      o ikisi belgeyi bulur, bu kart PARAYI bulup belgeyi arar).
 * Hangisi olduğunu ancak kullanıcı bilir; kart suçlamaz, tutarı ve hesabı
 * gösterir (kart anatomisi kuralı 5).
 *
 * ── Ölçüm (2026-09-07, canlı 34 firma) ve doğan üç süzgeç ──────────────────
 * Süzgeçsiz ilk sürüm 5 firmada 7 müşteri, 4 firmada 6 tedarikçi buluyordu.
 * Üçü YANLIŞTI ve üçü de ayrı bir sınıftı:
 *
 * 1. MAHSUP — cari hem müşteri hem tedarikçi. `earsin sinar` müşterisinde
 *    bakiye −₺78.365 görünüyor ama sebep fazla tahsilat değil: aynı cariye
 *    kayıtlı ₺194.427'lik AÇIK ALIŞ faturası (bakiye formülü onu haklı olarak
 *    düşüyor). `Kanyon Turizm` ve tedarikçi `11` de aynı sınıf. Bu carilere
 *    "fazla para aldınız" demek ilk gün haksız çıkmaktı → ters yönde faturası
 *    olan cari ELENİR.
 * 2. YUVARLAMA ARTIĞI — `BELGİN MADENİ YAĞLAR` −₺2 (₺1.011.901 alışa karşı
 *    ₺1.011.903 ödeme). Kart değil, kuruş farkı → `TABAN`.
 * 3. AÇILIŞ BAKİYESİ — kullanıcı "devreden alacağı var" diye BİLEREK CREDIT
 *    açılış girdiyse ters bakiye hata değil, kaydın kendisidir. Bu veride hiç
 *    yok (349 müşteri, 56 tedarikçinin tamamı DEBIT) ama ilk giren kişide kart
 *    haksız çıkardı → açılışın açıkladığı ters bakiye ELENİR.
 *
 * ── Dördüncü sınıf: ÇİFT ROLLÜ CARİ — elenmez, SÖYLENİR ───────────────────
 * Aynı iş ortağı hem müşteri hem tedarikçi olarak KAYITLIYSA (`isAlsoSupplier`
 * / `isAlsoCustomer`, `linkedSupplierId` ile eşlenmiş) iki ayrı kaydın iki ayrı
 * bakiyesi olur. Canlı veride bir eş var: EREN VİNÇ'in "EREN FORKLİFT"i müşteri
 * kaydında −₺1.500, tedarikçi kaydında −₺160.000.
 *
 * Bu kayıtlar MAHSUP EDİLMEZ, çünkü uygulamanın kendisi de etmiyor: ekstre tek
 * seferde tek kaydı açıyor (`app/api/cari/ekstre`), cari listesi iki satır
 * gösteriyor. Kart burada mahsup etseydi, hiçbir ekranda görünmeyen bir rakam
 * üretirdi — K-THS-07'de konan "ikinci formül yazma" kuralının ihlali. Onun
 * yerine kart, çift rolü GEREKÇEDE söyler: okuyan kişi iki kaydı kendisi
 * birleştirsin.
 *
 * Süzgeçlerden sonra kalan 5 müşteri / 5 tedarikçinin hepsi gerçek:
 *   Özkan Karakan      ₺100.000 çek alınmış, HİÇ fatura kesilmemiş
 *   NURİ KARLİFE       ₺690.000 ödeme + ₺200.000 çek, HİÇ alış faturası yok
 *   PAMUKKALE          2 fatura ₺88.716'ya karşı ₺100.000'lik senet
 *   Denizli Özstar     ₺31.200 fatura, ₺35.000 tahsilat
 *   REFORM KABLO       ₺6.015 alış, ₺46.019 ödeme
 *
 * ── EKSTREYLE AYRIŞMA: bulundu ve KAYNAĞINDA düzeltildi ────────────────────
 * TARAYICI DENETİMİNDE ÇIKTI (2026-09-07): kart ABC Müşteri için ₺47.214
 * derken ekstre ekranı −₺62.214 gösteriyordu. Aradaki ₺15.000 o carinin AÇILIŞ
 * BAKİYESİYDİ: cari listesi ve yaşlandırma açılışı hesaba katıyor, ekstre ise
 * onun için satır üretmiyordu. Kartın yol açtığı bir şey değildi — ürünün iki
 * ekranı arasındaki tutarsızlıktı.
 *
 * 2026-09-08'de kaynağında düzeltildi (`lib/cari/ekstre-query.ts` → açılış
 * satırı; aynı denetimde çek/senedin ters yazıldığı ikinci hata da çıktı).
 * Doğrulandı: çeki/senedi ya da açılışı olan 13 carinin 13'ünde iki ekran artık
 * kuruşu kuruşuna aynı. Kart bu yüzden tekrar "ekstrede de aynı rakam" diyor.
 *
 * ── Tutar CARİ BAKİYEDİR — ikinci formül yazılmaz ───────────────────────────
 * K-THS-07'de öğrenilen kural burada da geçerli: tutar `lib/cari/list-query.ts`
 * bakiyesinden okunur, yani cari ekranının ve ekstrenin ta kendisinden. Kartın
 * "₺100.000 fazla" derken ekstrenin başka bir rakam göstermesi, kartların
 * tamamına olan güveni bitirirdi. Liste çağrısı K-THS-07 ile AYNI parametreyle
 * yapılır; `fetchCustomerList` kendi içinde önbellekli, ikinci çağrı sorgu
 * açmaz.
 *
 * ── Döviz ──────────────────────────────────────────────────────────────────
 * Bakiye formülü `totalAmount`ı para birimine bakmadan toplar (ekstre de öyle
 * gösterir). Bu veride fatura 594/594 TRY olduğu için bugün bir etkisi yok; ama
 * $1.000'lik bir fatura ₺1.000 gibi toplanacağı gün, ters bakiye kayıt hatası
 * değil KUR ARTIĞI olurdu. Kart o cariyi sessizce atlar — K-BLG-01'in "döviz
 * faturayı toplama katma" kuralının aynısı.
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { fetchCustomerList, fetchSupplierList } from "@/lib/cari/list-query"
import { sayi } from "@/lib/asistan/veri/temel"

/** Bu tutarın altındaki ters bakiye kuruş farkıdır, kart konusu değildir. */
export const TABAN = 100

/** Kartın içinde adı geçecek cari sayısı. */
export const ORNEK_CARI_SAYISI = 3

export type TersBakiyeYonu = "musteri" | "tedarikci"

export type TersBakiyeCarisi = {
  id: string
  slug: string | null
  ad: string
  yetkili: string | null
  telefon: string | null
  /** Ters yöndeki tutar — POZİTİF yazılır (bakiyenin mutlak değeri). */
  tutar: number
  /** Doğal yöndeki (müşteride satış, tedarikçide alış) belge sayısı. */
  faturaAdet: number
  /** Aynı belgelerin toplamı — "neye karşılık" sorusunun cevabı. */
  faturaToplam: number
  /** Cari, karşı tarafta da kayıtlı mı (müşteri ↔ tedarikçi eşi var mı)? */
  ciftRol: boolean
}

export type TersBakiyeOzeti = {
  yon: TersBakiyeYonu
  adet: number
  /** Hiç faturası olmayan cari sayısı — kartın en güçlü hâli. */
  faturasizAdet: number
  /** En büyük ters bakiye. TOPLAM YAZILMAZ (aşağıya bak). */
  enBuyuk: number
  /** Listedeki carilerden biri çift rollüyse kart bunu SÖYLER (bkz. başlık). */
  ciftRolVar: boolean
  ornekler: TersBakiyeCarisi[]
}

/** Satış ailesi: satış faturası + satış iadesi (iade ters işaretle toplanır). */
const SATIS_AILESI = Prisma.sql`(i.type = 'SALES' OR (i.type = 'RETURN' AND COALESCE(i."returnKind", 'SALES') <> 'PURCHASE'))`

/** Alış ailesi: alış faturası + alış iadesi. */
const ALIS_AILESI = Prisma.sql`(i.type = 'PURCHASE' OR (i.type = 'RETURN' AND COALESCE(i."returnKind", 'SALES') = 'PURCHASE'))`

/** Bir carinin fatura sayaçları — sorgudan gelir, saf süzgece girdi olur. */
export type FaturaSayisi = {
  id: string
  dogal_adet: bigint | number
  dogal_tutar: unknown
  ters_adet: bigint | number
  doviz_adet: bigint | number
}

/**
 * Bakiyesi ters yöne dönmüş cariler.
 *
 * İki adım: bakiyeyi cari listesi söyler, "neye karşılık" sorusunu faturalar.
 * Fatura sorgusu YALNIZ aday carilere koşar — ters bakiye nadir olduğu için
 * (34 firmada 13 cari) bütün faturaları taramanın anlamı yok.
 */
export async function tersBakiyeOzeti(
  companyId: string,
  yon: TersBakiyeYonu
): Promise<TersBakiyeOzeti | null> {
  const liste =
    yon === "musteri"
      ? await fetchCustomerList({ companyId })
      : await fetchSupplierList({ companyId })

  const adaylar = liste.items.filter((c) => Number(c.balance) < -TABAN)
  if (adaylar.length === 0) return null

  const kolon = Prisma.raw(yon === "musteri" ? `"customerId"` : `"supplierId"`)
  const dogal = yon === "musteri" ? SATIS_AILESI : ALIS_AILESI
  const ters = yon === "musteri" ? ALIS_AILESI : SATIS_AILESI

  const rows = await prisma.$queryRaw<FaturaSayisi[]>(Prisma.sql`
    SELECT i.${kolon} AS id,
           COUNT(*) FILTER (WHERE ${dogal})                        AS dogal_adet,
           COALESCE(SUM(CASE WHEN i.type = 'RETURN' THEN -i."totalAmount"
                             ELSE i."totalAmount" END)
                    FILTER (WHERE ${dogal}), 0)                    AS dogal_tutar,
           COUNT(*) FILTER (WHERE ${ters})                         AS ters_adet,
           COUNT(*) FILTER (WHERE i.currency <> 'TRY')             AS doviz_adet
    FROM invoices i
    WHERE i.${kolon} IN (${Prisma.join(adaylar.map((c) => c.id))})
      AND i.status NOT IN ('CANCELLED', 'CONVERTED')
    GROUP BY i.${kolon}
  `)

  const faturalar = new Map(rows.map((r) => [r.id, r]))
  return tersBakiyeSec(adaylar, faturalar, yon)
}

/**
 * SÜZGEÇLER VE ÖZET — saf fonksiyon, veritabanı bilmez.
 *
 * Sorgudan AYRI duruyor çünkü kartın bütün kararı burada: dört yanlış-pozitif
 * sınıfı (taban, mahsup, döviz, açılış) bu satırlarda eleniyor ve dördü de canlı
 * ÖLÇÜMLE bulundu. Ölçüm bir kerelikti; süzgeçlerden biri yarın kaldırılırsa
 * hiçbir sorgu hata vermez, kart sessizce yanlış cariyi göstermeye başlar. Saf
 * hâlde durunca testle korunuyorlar (`ters-bakiye.test.ts`).
 */
export function tersBakiyeSec(
  adaylar: Array<Record<string, unknown> & { id: string; name: string; balance: number }>,
  faturalar: Map<string, FaturaSayisi>,
  yon: TersBakiyeYonu
): TersBakiyeOzeti | null {
  const kalanlar: TersBakiyeCarisi[] = []
  for (const c of adaylar) {
    const f = faturalar.get(c.id)
    const tutar = Math.abs(Number(c.balance))

    // TABAN: kuruş farkı kart konusu değil (ölçümde ₺2'lik yuvarlama artığı
    // çıkmıştı). Sorgu tarafında da uygulanıyor; burada tekrarı, saf fonksiyonun
    // tek başına doğru olmasını sağlıyor.
    if (!(tutar > TABAN)) continue
    // MAHSUP: ters yönde faturası olan caride bakiye netleşmeden doğar.
    if (f && Number(f.ters_adet) > 0) continue
    // DÖVİZ: bakiye kur çevirmeden toplandığı için tutar yorumlanamaz.
    if (f && Number(f.doviz_adet) > 0) continue
    // AÇILIŞ: kullanıcının bilerek girdiği devreden bakiye ters yönü zaten
    // açıklıyorsa ortada hata yok. İşaret yöne göre döner (bkz. list-query).
    if (acilisAcikliyor(c, yon, tutar)) continue

    kalanlar.push({
      id: c.id,
      slug: typeof c.slug === "string" && c.slug ? c.slug : null,
      ad: c.name,
      yetkili: typeof c.contactPerson === "string" ? c.contactPerson : null,
      telefon: typeof c.phone === "string" ? c.phone : null,
      tutar,
      faturaAdet: f ? Number(f.dogal_adet) : 0,
      faturaToplam: f ? sayi(f.dogal_tutar) : 0,
      ciftRol: Boolean(yon === "musteri" ? c.isAlsoSupplier : c.isAlsoCustomer),
    })
  }

  if (kalanlar.length === 0) return null

  kalanlar.sort((a, b) => b.tutar - a.tutar)

  return {
    yon,
    adet: kalanlar.length,
    faturasizAdet: kalanlar.filter((c) => c.faturaAdet === 0).length,
    enBuyuk: kalanlar[0].tutar,
    ciftRolVar: kalanlar.slice(0, ORNEK_CARI_SAYISI).some((c) => c.ciftRol),
    // TOPLAM ALINMIYOR — K-NKT-06'daki gerekçenin aynısı: veride
    // ₺3.213.123.123.123 tutarlı bir çek var; toplanan her rakam onunla
    // birlikte okunamaz hâle gelir. Cariler kartın içinde tek tek yazılır.
    ornekler: kalanlar.slice(0, ORNEK_CARI_SAYISI),
  }
}

/**
 * Ters bakiyeyi, kullanıcının kendi girdiği açılış bakiyesi açıklıyor mu?
 *
 * Müşteride CREDIT açılış ("bize borcu yok, bizim ona borcumuz var"), tedarikçide
 * DEBIT açılış ("avans verilmiş") bakiyeyi eksiye çeker. Böyle bir kayıt varsa
 * ters bakiye bir tutarsızlık değil, girilen bilginin ta kendisidir.
 *
 * DIŞA AÇIK, çünkü CANLI VERİ BUNU HİÇ SINAMIYOR: 349 müşteri ve 56 tedarikçinin
 * tamamı DEBIT açılışla duruyor, yani işaretin ters çevrildiği dal ölçümde bir
 * kez bile koşmadı. İki tipten hangisinin hangi yönde ters olduğu kolayca yer
 * değiştirir ve yanlışı, ilk CREDIT açılış giren kullanıcıda — sessizce — ortaya
 * çıkardı. Ölçemediğim yeri testle tutuyorum.
 */
export function acilisAcikliyor(
  c: Record<string, unknown>,
  yon: TersBakiyeYonu,
  tutar: number
): boolean {
  const acilis = Number(c.openingBalanceAmount ?? 0)
  if (!(acilis > 0)) return false
  const tersTip = yon === "musteri" ? "CREDIT" : "DEBIT"
  if (c.openingBalanceType !== tersTip) return false
  return acilis >= tutar
}
