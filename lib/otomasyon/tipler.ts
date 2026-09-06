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
   * Karta basılan ham rakamlar — günlüğe `payload` olarak yazılır.
   * Sonradan "kart haklı çıktı mı" ancak bununla ölçülür.
   */
  olcum: Record<string, unknown>
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
