/**
 * Otomasyon kartlarının ortak tipleri.
 *
 * İSTEMCİ DE OKUYOR (kart bileşeni), bu yüzden burada Prisma'ya HİÇ dokunulmaz —
 * `lib/asistan/tipler.ts` ve `lib/fis-ocr/models.ts`teki ayrımın aynısı.
 *
 * ── Kart nedir, sinyalden farkı ne? ──────────────────────────────────────────
 * `lib/asistan/sinyaller.ts` bir DURUM listeler: "9 ürün minimum seviyenin
 * altında". Kart ise bir KARAR sunar: "bugün sipariş vermezsen 2 gün sonra
 * bardaksız kalacaksın, Ege Ambalaj 4 günde getiriyor, Murat Bey 0532…".
 * Aradaki fark kartın taşıdığı dört alandır: `sonTarih`, `gerekce`, `karsiTaraf`
 * ve `aksiyonlar`. Bu dördü olmadan kart, sinyalin süslenmiş hâlidir.
 *
 * Katalog ve kod şeması: `docs/otomasyonlar/KATALOG.md`
 */

/**
 * Kartın aciliyeti. Sıralama ve renk bundan türer.
 *
 * Sinyaldeki üçlüden (`kritik|uyari|bilgi`) ayrı ve dört kademeli: kart günlüğe
 * yazılıyor ve ileride "bu kullanıcı hangi kademede hareket ediyor" diye
 * sorulacak. Üç kademe o soruyu ölçmek için fazla kaba kalıyor.
 */
export type KartOnem = "kritik" | "yuksek" | "orta" | "dusuk"

export const ONEM_SIRASI: Record<KartOnem, number> = {
  kritik: 0,
  yuksek: 1,
  orta: 2,
  dusuk: 3,
}

/** Karttaki tek bir buton. `anahtar` günlüğe `actionKey` olarak yazılır. */
export type KartAksiyonu = {
  anahtar: string
  etiket: string
  /**
   * Panel içi hedef. `CompanyLink` ile basılır — firma param'ı OTOMATİK eklenir,
   * buraya `?company=` yazılmaz (bkz. CLAUDE.md).
   */
  href?: string
  /** Birincil buton mu — kartta yalnız biri olur. */
  birincil?: boolean
}

/** Kartın "kimi arayacaksın" bloğu. Yoksa blok basılmaz. */
export type KartKarsiTarafi = {
  ad: string
  yetkili?: string | null
  telefon?: string | null
  href?: string
}

/**
 * Panoya basılan tek kart.
 *
 * RAKAMLAR SUNUCUDAN GELDİĞİ GİBİ BASILIR. Metin burada, `lib/format.ts`
 * yardımcılarıyla kurulur; istemcide ikinci bir biçimlendirme katmanı olsaydı
 * aynı tutar kartta ve raporda farklı görünürdü.
 */
export type Kart = {
  /** K-STK-01 — ASLA değişmez, günlüğün birincil ayrımı. */
  kod: string
  /** Eşik/metin değişince artar, kod korunur. */
  surum: number
  onem: KartOnem

  /** Kartın hakkında olduğu kayıt — kişiselleştirme bu eksende yapılacak. */
  ozneTuru: string
  ozneId: string

  /** Tek cümle: DURUM DEĞİL, SONUÇ. "…2 gün sonra bardaksız kalacaksın." */
  baslik: string
  /** Hesabın kendisi: "Günde 50 adet gidiyor, elde 6 paket var…" */
  gerekce: string
  /** Aciliyetin sözle karşılığı: "Bugün sipariş verilmeli." */
  sonTarih?: string

  karsiTaraf?: KartKarsiTarafi
  aksiyonlar: KartAksiyonu[]

  /**
   * Kartın PARASAL AĞIRLIĞI (TL) — yalnız sıralama içindir, ekranda basılmaz.
   *
   * Gürültü bütçesi panoya üç kart basıyor (`GOSTERILECEK`) ve hangi üçü
   * olduğunu bu alan gelene kadar dizideki SIRA belirliyordu: aynı önemdeki iki
   * kart arasında kayıt defterinde önce yazılan kazanıyordu. Ölçüldüğünde
   * (2026-09-07, canlı) bu tesadüf HİDROEREN'de şunu yapıyordu: ₺5.500'lük eksi
   * kasa kartı, "₺100.000 alınmış ama hiç fatura kesilmemiş" kartının ÖNÜNDE
   * duruyordu — ikisi de "yüksek", sırayı yalnız yazılma tarihleri belirliyordu.
   *
   * Kartın konusu para değilse (negatif stok, vadesi geçmiş evrak, fiyat farkı)
   * alan 0 kalır ve kart kendi önem kademesinin sonuna düşer. Bu bilinçli: üç
   * kartlık bütçede, parayla ifade edilebilen sonuç önce gelir. Kademe zaten
   * aciliyeti taşıdığı için pratikte bu kartlar ekrandan düşmüyor — negatif stok
   * "kritik" olduğu için hâlâ ilk üçte (ölçüm: Reypo ve EREN FORKLİFT).
   *
   * NEDEN ÇARPIM DEĞİL: katalog §7 "önem × parasal etki" diyordu. Çarpım iki
   * ölçeği karıştırıyor — `onem` her kartın KENDİ eşiğinden geliyor (K-NKT-08'de
   * ₺100.000, K-BLG-01'de 50 belge), yani kartlar arasında karşılaştırılabilir
   * değil; tutar ise karşılaştırılabilir. Dahası canlı veride ₺3.213.123.123.123
   * tutarlı bir çek var: çarpımda o tek kayıt panonun en üst sırasını kalıcı
   * olarak işgal ederdi. Bu yüzden sıra ÖNCE önem, SONRA tutar.
   */
  etki?: number

  /**
   * Karta basılan ham rakamlar — günlüğe `payload` olarak yazılır.
   * Sonradan "kart haklı çıktı mı" ancak bununla ölçülür.
   */
  olcum: Record<string, unknown>
}

/**
 * Panodaki sıralama kuralı: ÖNCE önem kademesi, SONRA parasal etki.
 *
 * Kayıt defterindeki `sort` çağrısından ayrı bir fonksiyon, çünkü kural üç
 * satırlık ama sessizce ters çevrilebilir bir şey: `etki` farkı yanlış yöne
 * yazılırsa pano en küçük tutarı en üste basar ve bunu hiçbir hata göstermez.
 * Ayrı durunca testle tutuluyor.
 *
 * `Array.prototype.sort` kararlıdır: ikisi de eşitse kayıt defterindeki sıra
 * korunur.
 */
export function kartSirasi(a: Kart, b: Kart): number {
  return ONEM_SIRASI[a.onem] - ONEM_SIRASI[b.onem] || (b.etki ?? 0) - (a.etki ?? 0)
}

/**
 * Kartın çalışabilmesi için gereken modül ve menü sayfası.
 *
 * İkisi de şart, gerekçesi `lib/asistan/tipler.ts`teki `SinyalKapisi` ile aynı:
 * modül kapalıysa kart gürültüdür, sayfa kapalıysa kullanıcının o veriyi görme
 * yetkisi yoktur ve kart yetkilendirmenin etrafından dolaşan bir kapı olurdu.
 */
export type KartKapisi = {
  modul?: string
  sayfa?: string
}

/** Kullanıcının kart üzerinde verdiği karar — günlüğe aynen yazılır. */
export type KartKarari = "ACTED" | "DISMISSED" | "SNOOZED"

/**
 * Panoya en fazla kaç kart BASILIR — gerisi sayıyla duyurulur.
 *
 * SUNUCU DA OKUR, İSTEMCİ DE, çünkü günlüğün ölçtüğü şey "kullanıcıya gösterildi"
 * olmalı. Sayı yalnız bileşende dursaydı uç bütün kartları "gösterildi" diye
 * yazardı; ekranda hiç görünmemiş kart, sonradan "gösterildi ama umursanmadı"
 * havuzunda çıkar ve kartın yanıt oranını olduğundan düşük gösterirdi — tam da
 * bu günlüğün cevaplamak için tutulduğu soruyu bozar.
 *
 * (2026-09-06'da elle yakalandı: ekranda 3 kart varken günlüğe 4 satır düşüyordu.)
 */
export const GOSTERILECEK = 3
