/**
 * YEVMİYE FİŞİ — kural motorlarının ortak dili. Saf modül (Prisma yok).
 *
 * Her kaynak (fatura, kasa hareketi, çek, bordro, açılış…) kendi kural dosyasında
 * `FisSonucu` üretir; kaydetme, hesabı firmanın planında çözme ve onay
 * `senkron.server.ts`tedir. Plan: `docs/muhasebe/MOTOR-PLAN.md`.
 *
 * Sözleşme:
 * - Fiş DENGELİDİR (borç = alacak, kuruşu kuruşuna). Kural dosyası dengeyi kurar.
 * - Hesap bilinmiyorsa satır HESAPSIZ kalır (`hesapKodu: null`) ve `oneriKodu`
 *   taşır; fiş onaylanamaz. Sessizce yanlış hesaba yazılmaz.
 * - Cari / kasa / personel satırı ana hesaba değil o kaydın ALT HESABINA yazılır
 *   (`alt`): 120.01.0001 "<cari> — <VKN>". Alt hesap çözümde açılır.
 * - Satırın varsayılanı bir TAHMİN ise (alış gideri 770 mi 153 mü, faturasız
 *   giderin hesabı) fiş "emin" sayılmaz ve toplu onaya girmez.
 */

export type Taraf = "B" | "A"

export type SatirRolu =
  // Belge (fis-kurallari.ts)
  | "CARI"
  | "SATIS"
  | "SATIS_IADE"
  | "ALIS"
  | "KDV_HESAPLANAN"
  | "KDV_INDIRILECEK"
  | "TEVKIFAT"
  | "OTV"
  | "DIGER_VERGI"
  | "YUVARLAMA"
  // Para hareketleri (para-kurallari.ts)
  | "PARA" // kasa / banka / kart alt hesabı
  | "PARA_KARSI" // virmanın karşı kasası
  | "KIYMET" // 101 / 103 / 121 / 321
  | "PERSONEL" // 335 personel alt hesabı
  | "GELIR" // faturasız gelir (649)
  | "GIDER" // faturasız gider (770)
  | "BAKIYE_KAPAMA" // 611 / 649
  | "KARSI" // karşı hesabı bilinmeyen satır (tek taraflı virman, kasasız ödeme)
  // Türlü hareket (lib/finans/hareket-turu.ts) — gelir/gider değil, borç/alacak hesabı
  | "VERGI_ODEME" // 360 (KDV ve diğer vergi ödemesi)
  | "SGK_ODEME" // 361
  | "AVANS" // 196 personel avansı
  | "KREDI" // 300 banka kredisi
  | "ORTAK" // 331 / 131
  // Demirbaş (lib/muhasebe/amortisman.ts)
  | "AMORTISMAN_GIDER" // 770 / 730 … (öğrenilir)
  | "AMORTISMAN" // 257 / 268 birikmiş amortisman
  // Bordro
  | "BORDRO_GIDER"
  | "BORDRO_SGK"
  | "BORDRO_VERGI"
  | "BORDRO_DIGER"
  | "BORDRO_AVANS"
  // Açılış / kapanış / elle
  | "ACILIS"
  | "ACILIS_FARK"
  | "KAPANIS"
  | "MANUEL"

/** Satırın hesabı nereden geldi. */
export type HesapKaynagi = "ogrenilen" | "cari" | "varsayilan" | "yok"

/** Alt hesabı açılacak kayıt türü. */
export type AltHesapTuru = "musteri" | "tedarikci" | "finans" | "personel"

/**
 * Satırın yazılacağı alt hesap: kaydın kendisi (cari / kasa / personel). `id: null`
 * = kayıtsız ortak alt hesap (perakende müşteri, carisiz alış): `120.01.0000`.
 */
export type AltHesapRef = {
  tur: AltHesapTuru
  id: string | null
  /** Hesap adı açılırken kullanılır ("<cari> — <VKN>"). */
  ad: string
  /** finans: CASH | BANK | CREDIT_CARD — ana hesabı belirler. */
  altTur?: string | null
}

export type FisSatiri = {
  taraf: Taraf
  /** TL, kuruşa yuvarlı, sıfırdan büyük. */
  tutar: number
  rol: SatirRolu
  /** Fişe yazılacak hesap; bilinmiyorsa null (fiş onaylanamaz). */
  hesapKodu: string | null
  /** Hesap seçilirken önerilecek ana hesap. */
  oneriKodu: string
  kaynak: HesapKaynagi
  /** Hesap değiştirilirse öğrenilecek anahtar(lar). */
  anahtarlar: string[]
  aciklama: string
  /** Satır bir kaydın alt hesabına yazılır (cari, kasa, personel). */
  alt?: AltHesapRef
}

export type HesapEslesmeleri = {
  /** Öğrenme anahtarı → hesap kodu (ör. "alis:urun:<id>" → "770.01.003"). */
  ogrenilen: Readonly<Record<string, string>>
  /** Cari id → cari alt hesap kodu (120.… / 320.…). Çözüm katmanı boş geçebilir. */
  cariHesaplari: Readonly<Record<string, string>>
}

export const BOS_ESLESME: HesapEslesmeleri = { ogrenilen: {}, cariHesaplari: {} }

/** Fiş türü — yevmiyede "Tahsil / Tediye / Mahsup" sütunu. */
export type FisTuru = "ACILIS" | "MAHSUP" | "TAHSIL" | "TEDIYE" | "KAPANIS"

export type HazirFis = {
  durum: "hazir"
  tarih: Date
  aciklama: string
  tur: FisTuru
  satirlar: FisSatiri[]
  borcToplami: number
  alacakToplami: number
  /** Toplu onaya uygun mu (her satırın hesabı belli, hiçbiri riskli tahmin değil). */
  emin: boolean
}

export type FisSonucu =
  | HazirFis
  | { durum: "fise-girmez"; sebep: string }
  | { durum: "kur-yok"; sebep: string }

/**
 * Varsayılanı TAHMİN olan roller. Bunlar varsayılan hesapla kalırsa fiş "emin"
 * sayılmaz: alış gider mi stok mu, faturasız gider hangi gider, karşı hesap ne —
 * bunları müşavir bilir. Diğer rollerin varsayılanı Tekdüzen'in kendisidir (KDV 391,
 * satış 600, kasa 100 …) ve tahmin değildir.
 */
export const TAHMIN_ROLLERI: ReadonlySet<SatirRolu> = new Set<SatirRolu>([
  "ALIS",
  "GELIR",
  "GIDER",
  "KARSI",
  "BAKIYE_KAPAMA",
  "BORDRO_GIDER",
  "ACILIS_FARK",
  // Kısa mı uzun vadeli mi (300/400), ortak hesabı mı sermaye mi (331/131/500) — müşavir bilir.
  "KREDI",
  "ORTAK",
  // Genel yönetim mi üretim mi (770/730/760) — demirbaşın kullanıldığı yer.
  "AMORTISMAN_GIDER",
])

/**
 * Varsayılanı OLMAYAN roller: önerilen kod yalnız ÖNERİDİR, kendiliğinden yazılmaz
 * (tek taraflı virmanın karşılığı, açılış farkı, elle satır). Taslak yeniden
 * çözülürken bu satırlar ancak öğrenilmiş bir eşleşmeyle hesap alır.
 */
export const VARSAYILANSIZ_ROLLER: ReadonlySet<SatirRolu> = new Set<SatirRolu>(["KARSI", "ACILIS_FARK", "MANUEL"])

/** Hep bir kaydın ALT HESABINA yazılan roller (cari, kasa, personel). */
export const ALT_ROLLERI: ReadonlySet<SatirRolu> = new Set<SatirRolu>(["CARI", "PARA", "PARA_KARSI", "PERSONEL"])

export const r2 = (n: number) => Math.round(n * 100) / 100
export const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
export const ters = (t: Taraf): Taraf => (t === "B" ? "A" : "B")

/** Satır toplu onaya engel mi: hesapsız ya da riskli varsayılan. */
export function satirEminMi(s: Pick<FisSatiri, "hesapKodu" | "kaynak" | "rol" | "alt">): boolean {
  // Alt hesap satırı (cari/kasa/personel) çözümde kesin bir hesaba bağlanır.
  if (s.alt) return true
  if (s.hesapKodu === null) return false
  return s.kaynak !== "varsayilan" || !TAHMIN_ROLLERI.has(s.rol)
}

export function toplam(satirlar: FisSatiri[], t: Taraf): number {
  return r2(satirlar.filter((s) => s.taraf === t).reduce((a, s) => a + s.tutar, 0))
}

/** Öğrenilmiş hesap varsa o, yoksa varsayılan. */
export function hesapSec(
  eslesme: HesapEslesmeleri,
  anahtarlar: string[],
  varsayilan: string | null,
): { hesapKodu: string | null; kaynak: HesapKaynagi } {
  for (const a of anahtarlar) {
    const kod = eslesme.ogrenilen[a]
    if (kod) return { hesapKodu: kod, kaynak: "ogrenilen" }
  }
  return varsayilan ? { hesapKodu: varsayilan, kaynak: "varsayilan" } : { hesapKodu: null, kaynak: "yok" }
}

/** Alt hesaba yazılan satırın kaynağı "cari"; hesap kodu çözümde verilir. */
export function altSatir(
  s: Omit<FisSatiri, "hesapKodu" | "kaynak" | "anahtarlar"> & { alt: AltHesapRef; anahtarlar?: string[] },
): FisSatiri {
  return { ...s, anahtarlar: s.anahtarlar ?? [], hesapKodu: null, kaynak: "cari" }
}

/**
 * Satırları kuruşa yuvarlar, sıfırları atar, eksi tutarı karşı tarafa geçirir,
 * borç önce sıralar ve fişi kapatır. Denge satırlardan BEKLENİR — tutmuyorsa
 * hata fırlatır (kural dosyası hatalıdır; sessizce dengesiz fiş yazılmaz).
 */
export function fisKur(input: {
  tarih: Date | string
  aciklama: string
  tur: FisTuru
  satirlar: FisSatiri[]
}): HazirFis {
  const satirlar: FisSatiri[] = []
  for (const s of input.satirlar) {
    const tutar = r2(s.tutar)
    if (tutar === 0) continue
    satirlar.push({ ...s, tutar: Math.abs(tutar), taraf: tutar < 0 ? ters(s.taraf) : s.taraf })
  }
  satirlar.sort((a, b) => (a.taraf === b.taraf ? 0 : a.taraf === "B" ? -1 : 1))
  const borc = toplam(satirlar, "B")
  const alacak = toplam(satirlar, "A")
  if (borc !== alacak) {
    throw new Error(`Dengesiz fiş (${input.aciklama}): borç ${borc} ≠ alacak ${alacak}`)
  }
  return {
    durum: "hazir",
    tarih: new Date(input.tarih),
    aciklama: input.aciklama,
    tur: input.tur,
    satirlar,
    borcToplami: borc,
    alacakToplami: alacak,
    emin: satirlar.every(satirEminMi),
  }
}

/**
 * Kaydın İSTANBUL takvim günü, 00:00 UTC olarak. Fiş tarihi gün düzeyindedir ve
 * fatura tarihleriyle (00:00 UTC) aynı eksende durmalı: saatli bir kasa hareketi
 * (23:30 İstanbul = 20:30 UTC) ya da İstanbul gece yarısıyla saklanan gelen fatura
 * (21:00 UTC) ham UTC gününe bakılınca ÖNCEKİ güne düşerdi. Türkiye 2016'dan beri
 * sabit UTC+3.
 */
export function istanbulGunu(d: Date | string): Date {
  const t = new Date(new Date(d).getTime() + 3 * 3_600_000)
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()))
}

/**
 * UTC takvim günü, 00:00 UTC. FATURA fişleri bunu kullanır: KDV raporu dönemi
 * `invoices.date` üzerinden UTC ay sınırıyla süzer (lib/raporlar/kdv-kural.ts);
 * fiş başka bir eksende olsaydı ay sonu belgesi mizanda başka aya, KDV raporunda
 * başka aya düşerdi.
 */
export function utcGunu(d: Date | string): Date {
  const t = new Date(d)
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()))
}
