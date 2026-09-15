import { trFold } from "@/lib/text/tr-fold"

/**
 * İK belge şablonlarının ALAN SÖZLÜĞÜ — saf kural, istemcide de çalışır.
 *
 * Şablon gövdesi `{Personel Ad Soyad}` gibi süslü parantezli adlar taşır. Bir ad
 * sözlükte varsa değeri KAYITTAN gelir (firma/personel kartı); yoksa belge
 * doldurulurken kullanıcıya boş bir kutu olarak çıkar.
 *
 * NEDEN SÖZLÜK ÖNCE: rakip üründe `{İşe Başlama Tarihi}` elle yazılan bir kutuydu,
 * oysa tarih personel kartında duruyordu — kullanıcı sistemin bildiği veriyi her
 * belgede yeniden yazıyor ve yazım hatası belgeye giriyordu. Sözlüğü genişletmek
 * ekran değişikliği gerektirmez: buraya bir satır eklemek yeter.
 *
 * ELLE ALAN KAYBOLMAZ: sözlükte olmayan ad hata değildir. "Teslim Eden", "Ceza
 * Tutarı" gibi belgeye özgü alanlar zaten elle doldurulmalıdır; sözlük yalnız
 * sistemin BİLDİĞİ veriyi otomatikleştirir.
 *
 * TANIM VE ÇÖZÜM AYNI SATIRDA: her alanın `coz`'ü kendi tanımının içindedir. İkisi
 * ayrı tablolarda dursaydı yeni alan eklerken biri unutulur, alan ekranda görünüp
 * belgede boş çıkardı.
 */

/** Alanın değeri nereden gelir? */
export type BelgeAlanKaynagi = "FIRMA" | "PERSONEL" | "BELGE" | "ELLE"

/**
 * Alanın tipi — doldurma ekranındaki kutu buna göre çizilir.
 *
 * Rakipte her alan düz metindi ve aynı üründe iki farklı tarih formatı dolaşıyordu
 * ("01.01.2026" ile "1-1-2026"). Tip, formatı TEK yerde tutar.
 */
export type BelgeAlanTipi = "METIN" | "TARIH" | "PARA" | "SAYI"

/** Şablonun okuduğu firma alanları (seçili firma — şubede şubenin kendisi). */
export type BelgeFirma = {
  name: string
  taxNumber?: string | null
  taxOffice?: string | null
  address?: string | null
  city?: string | null
  district?: string | null
  phone?: string | null
  email?: string | null
  branchName?: string | null
  branchNo?: string | null
}

/** Şablonun okuduğu personel alanları. */
export type BelgePersonel = {
  firstName: string
  lastName: string
  nationalId?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  position?: string | null
  department?: string | null
  birthDate?: string | Date | null
  hireDate?: string | Date | null
  terminationDate?: string | Date | null
  iban?: string | null
  // Prisma Decimal, kaydı spread eden uçlarda JSON'a STRING olarak iner; ikisini de
  // kabul ediyoruz (bkz. prisma-decimal-json-string).
  grossSalary?: number | string | null
  netSalary?: number | string | null
  annualLeaveDays?: number | null
}

export type BelgeKaynagi = {
  firma: BelgeFirma
  /** Personelsiz belge de basılabilir (örn. yalnız firma alanı taşıyan duyuru). */
  personel?: BelgePersonel | null
  /** Belgenin tarihi; verilmezse bugün. */
  tarih?: Date
}

export type BelgeAlaniTanimi = {
  /** `{}` içinde yazılan ad; ekranda da böyle görünür. */
  ad: string
  kaynak: Exclude<BelgeAlanKaynagi, "ELLE">
  tip: BelgeAlanTipi
  /** Şablon yazarına gösterilen kısa açıklama. */
  aciklama?: string
  /** Kayıttan değeri çözer. Veri yoksa boş dizi döner — "-" YAZMAZ (bkz. aşağıda). */
  coz: (kaynak: BelgeKaynagi) => string
}

/** Elle doldurulacak alan — sözlükte karşılığı olmayan `{...}`. */
export type ElleAlan = { ad: string; kaynak: "ELLE"; tip: BelgeAlanTipi }

const tarih = (d?: string | Date | null): string =>
  d ? new Date(d).toLocaleDateString("tr-TR") : ""

const para = (n?: number | string | null): string => {
  if (n === null || n === undefined || n === "") return ""
  const sayi = Number(n)
  if (!Number.isFinite(sayi)) return ""
  return `${sayi.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`
}

const metin = (s?: string | null): string => (s ?? "").trim()

/**
 * Sözlük. Sıra ekrandaki "kullanılabilir alanlar" listesinin sırasıdır.
 *
 * ŞUBE UYARISI: firma alanları SEÇİLİ firmadan çözülür, hesap kökünden değil.
 * Şubenin belgesi ana firmanın adresiyle çıkmamalı (bkz. CLAUDE.md → şube adresi).
 *
 * BOŞ VERİ "-" DEĞİL BOŞTUR: eksik alan belgede "-" olarak basılsaydı imzaya giden
 * metinde "Görevi: -" gibi bir satır dururdu. Boş bırakmak, doldurma ekranındaki
 * "şu alanlar boş" uyarısıyla birlikte doğru davranıştır.
 */
export const BELGE_ALANLARI: readonly BelgeAlaniTanimi[] = [
  // ---- Firma ----
  { ad: "Firma Unvan", kaynak: "FIRMA", tip: "METIN", coz: (k) => metin(k.firma.name) },
  {
    ad: "Firma VKN",
    kaynak: "FIRMA",
    tip: "METIN",
    aciklama: "Vergi / TC kimlik no",
    coz: (k) => metin(k.firma.taxNumber),
  },
  { ad: "Firma Vergi Dairesi", kaynak: "FIRMA", tip: "METIN", coz: (k) => metin(k.firma.taxOffice) },
  {
    ad: "Firma Adres",
    kaynak: "FIRMA",
    tip: "METIN",
    aciklama: "İlçe / il eklenir",
    coz: (k) => firmaAdresi(k.firma),
  },
  { ad: "Firma İl", kaynak: "FIRMA", tip: "METIN", coz: (k) => metin(k.firma.city) },
  { ad: "Firma İlçe", kaynak: "FIRMA", tip: "METIN", coz: (k) => metin(k.firma.district) },
  { ad: "Firma Telefon", kaynak: "FIRMA", tip: "METIN", coz: (k) => metin(k.firma.phone) },
  { ad: "Firma E-posta", kaynak: "FIRMA", tip: "METIN", coz: (k) => metin(k.firma.email) },
  {
    ad: "Şube Adı",
    kaynak: "FIRMA",
    tip: "METIN",
    aciklama: "Şube değilse boş",
    coz: (k) => metin(k.firma.branchName),
  },
  {
    ad: "Şube No",
    kaynak: "FIRMA",
    tip: "METIN",
    aciklama: "Şube değilse boş",
    coz: (k) => metin(k.firma.branchNo),
  },

  // ---- Personel ----
  {
    ad: "Personel Ad Soyad",
    kaynak: "PERSONEL",
    tip: "METIN",
    coz: (k) => (k.personel ? `${k.personel.firstName} ${k.personel.lastName}`.trim() : ""),
  },
  { ad: "Personel T.C. No", kaynak: "PERSONEL", tip: "METIN", coz: (k) => metin(k.personel?.nationalId) },
  { ad: "Personel Telefon", kaynak: "PERSONEL", tip: "METIN", coz: (k) => metin(k.personel?.phone) },
  { ad: "Personel E-posta", kaynak: "PERSONEL", tip: "METIN", coz: (k) => metin(k.personel?.email) },
  { ad: "Personel Adres", kaynak: "PERSONEL", tip: "METIN", coz: (k) => metin(k.personel?.address) },
  { ad: "Personel Görev", kaynak: "PERSONEL", tip: "METIN", coz: (k) => metin(k.personel?.position) },
  { ad: "Personel Departman", kaynak: "PERSONEL", tip: "METIN", coz: (k) => metin(k.personel?.department) },
  { ad: "Personel Doğum Tarihi", kaynak: "PERSONEL", tip: "TARIH", coz: (k) => tarih(k.personel?.birthDate) },
  { ad: "Personel İşe Giriş Tarihi", kaynak: "PERSONEL", tip: "TARIH", coz: (k) => tarih(k.personel?.hireDate) },
  {
    ad: "Personel İşten Çıkış Tarihi",
    kaynak: "PERSONEL",
    tip: "TARIH",
    coz: (k) => tarih(k.personel?.terminationDate),
  },
  { ad: "Personel IBAN", kaynak: "PERSONEL", tip: "METIN", coz: (k) => metin(k.personel?.iban) },
  { ad: "Personel Brüt Maaş", kaynak: "PERSONEL", tip: "PARA", coz: (k) => para(k.personel?.grossSalary) },
  { ad: "Personel Net Maaş", kaynak: "PERSONEL", tip: "PARA", coz: (k) => para(k.personel?.netSalary) },
  {
    ad: "Personel Yıllık İzin Hakkı",
    kaynak: "PERSONEL",
    tip: "SAYI",
    aciklama: "Gün",
    coz: (k) =>
      k.personel?.annualLeaveDays === null || k.personel?.annualLeaveDays === undefined
        ? ""
        : String(k.personel.annualLeaveDays),
  },

  // ---- Belge ----
  { ad: "Bugünün Tarihi", kaynak: "BELGE", tip: "TARIH", coz: (k) => tarih(k.tarih ?? new Date()) },
] as const

/** "Adres, İlçe / İl" — parçası eksikse ayraç da düşer. */
function firmaAdresi(firma: BelgeFirma): string {
  const yer = [metin(firma.district), metin(firma.city)].filter(Boolean).join(" / ")
  return [metin(firma.address), yer].filter(Boolean).join(", ")
}

/** Sözlük araması Türkçe duyarsızdır: `{personel ad soyad}` da tanınır. */
const SOZLUK = new Map(BELGE_ALANLARI.map((a) => [trFold(a.ad), a]))

export function belgeAlaniBul(ad: string): BelgeAlaniTanimi | undefined {
  return SOZLUK.get(trFold(ad.trim()))
}

/**
 * Şablon gövdesindeki `{...}` adları — ilk geçtikleri sırayla, TEKRARSIZ.
 *
 * Tekrarsızlık şart: aynı ad belgede beş kez geçse bile kullanıcı bir kez yazar.
 * Eşleştirme katlanmış ada göre yapılır ki `{Tarih}` ile `{TARİH}` iki ayrı kutu
 * doğurmasın; ekranda ilk yazılışı gösterilir.
 */
export function sablonAlanlari(body: string): Array<BelgeAlaniTanimi | ElleAlan> {
  const gorulen = new Set<string>()
  const sonuc: Array<BelgeAlaniTanimi | ElleAlan> = []

  for (const ad of hamAlanAdlari(body)) {
    const anahtar = trFold(ad)
    if (gorulen.has(anahtar)) continue
    gorulen.add(anahtar)

    const tanim = belgeAlaniBul(ad)
    sonuc.push(tanim ?? { ad, kaynak: "ELLE", tip: tahminiTip(ad) })
  }
  return sonuc
}

/** Yalnız elle doldurulacak alanlar — doldurma ekranının kutuları. */
export function elleDoldurulacakAlanlar(body: string): ElleAlan[] {
  return sablonAlanlari(body).filter((a): a is ElleAlan => a.kaynak === "ELLE")
}

/**
 * Gövdedeki ham adlar (tekrarlar dahil, sırasıyla).
 *
 * Desen İÇ İÇE GEÇMEYİ REDDEDER (`[^{}]`): şablon gövdesi HTML olduğu için bir CSS
 * ya da script parçası kaçarsa `{ color: red }` gibi bir blok alan sanılır ve
 * doldurma ekranı saçmalardı. Ad uzunluğu da sınırlıdır.
 */
function hamAlanAdlari(body: string): string[] {
  const adlar: string[] = []
  const desen = /\{([^{}\n]{1,60})\}/g
  let eslesme: RegExpExecArray | null
  while ((eslesme = desen.exec(body)) !== null) {
    const ad = eslesme[1].trim()
    if (ad) adlar.push(ad)
  }
  return adlar
}

/**
 * Elle doldurulacak alanın tipini adından tahmin eder — yalnız kutu çizimi için.
 *
 * DÖNEM SÖZCÜKLERİ PARA SÖZCÜKLERİNİ EZER: "Maaş Ayı" ve "Maaş Yılı" adında "maaş"
 * geçtiği için para sanılıyordu ve ay adı için kuruş basamaklı bir sayı kutusu
 * çiziliyordu. Sıra bilinçli; yanlış kutu, kullanıcının alanı boş bırakmasına yol
 * açar.
 */
function tahminiTip(ad: string): BelgeAlanTipi {
  const k = trFold(ad)
  if (k.includes("tarih")) return "TARIH"
  if (/\b(ay|ayi|yil|yili|donem|donemi)\b/.test(k)) return "METIN"
  if (k.includes("tutar") || k.includes("ucret") || k.includes("maas") || k.includes("bedel")) return "PARA"
  if (k.includes("adet") || k.includes("sayi") || k.includes("gun")) return "SAYI"
  return "METIN"
}

/**
 * Kayıttan çözülen alanların değerleri — ad → değer.
 *
 * Yalnız gövdede GEÇEN alanlar çözülür; belge 3 alan kullanıyorsa 25 alanın hepsi
 * hesaplanmaz ve ekrana taşınmaz.
 */
export function otomatikDegerler(body: string, kaynak: BelgeKaynagi): Record<string, string> {
  const degerler: Record<string, string> = {}
  for (const alan of sablonAlanlari(body)) {
    if (alan.kaynak === "ELLE") continue
    degerler[alan.ad] = alan.coz(kaynak)
  }
  return degerler
}

/**
 * Şablonu değerlerle doldurur.
 *
 * Bulunamayan ad BOŞ bırakılır, `{...}` olduğu gibi KALMAZ: basılan belgede
 * "{Banka}" yazması, kullanıcının bir alanı atladığını göstermenin en kötü yoludur —
 * belge zaten imzaya gitmiştir. Doldurma ekranı eksik alanı önceden söyler.
 */
export function sablonDoldur(body: string, degerler: Record<string, string>): string {
  const katlanmis = new Map(Object.entries(degerler).map(([k, v]) => [trFold(k), v]))
  return body.replace(/\{([^{}\n]{1,60})\}/g, (_tam, ad: string) => {
    const anahtar = trFold(String(ad).trim())
    return katlanmis.get(anahtar) ?? ""
  })
}

/**
 * Tek çağrıda: kayıttan çözülenler + elle girilenler birleştirilip gövde doldurulur.
 * Elle girilen değer, aynı adlı otomatik değeri EZER (kullanıcı düzeltmiş olabilir).
 */
export function belgeMetni(body: string, kaynak: BelgeKaynagi, elle: Record<string, string> = {}): string {
  return sablonDoldur(body, { ...otomatikDegerler(body, kaynak), ...elle })
}
