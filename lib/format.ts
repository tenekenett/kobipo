// Sayı/para biçimlendirmenin tek yeri.
//
// Bu dosyadan önce aynı üç yardımcı dört ayrı dosyada yeniden yazılmıştı
// (rapor UI, kahveci satış ekranı, reçete ekranı, fiş HTML'i) ve aralarında
// sessiz farklar vardı — biri `maximumFractionDigits` veriyor, diğeri
// vermiyordu. Aynı miktar iki ekranda iki türlü görünüyordu.
//
// Sunucuda da kullanılabilir (saf, tarayıcı API'si gerektirmez — Intl her iki
// çalışma zamanında da var).

/** ₺1.234,50 — para tutarları. */
export const money = (n: number) =>
  new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0)

/** ₺1.235 — kuruşun anlamsız olduğu özet kutuları (ciro, ortalama fiş). */
export const money0 = (n: number) =>
  new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0)

/**
 * Stok miktarı. Kolonlar `Decimal(14,4)` — 4 ondalık şart: 20 gr kahve KG
 * cinsinden 0,02; 5 ml vanilya LT cinsinden 0,005 eder. 2 ondalıkla
 * biçimlendirmek bunları ekranda sıfırlardı.
 */
export const qty = (n: number) =>
  new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(Number(n) || 0)

/** %80,0 — null/NaN girdide tire (0 DEĞİL: "hesaplanamadı" ile "sıfır" farklı). */
export const pct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `%${n.toFixed(1)}`

/**
 * "12,5" ve "12.5" ikisini de kabul eden sayı ayrıştırıcı; geçersizse NaN.
 * Türkçe klavyede ondalık ayırıcı virgül — form girdilerinde şart.
 */
export const parseNum = (raw: string): number =>
  parseFloat(String(raw ?? "").replace(",", "."))

// --- Filtre kutularının ortak yardımcıları -----------------------------------
// Gelen e-faturalar ve fatura listesi ekranları aynı "detaylı filtre" panelini
// kullanıyor; bu dördü iki yerde birden gerekiyor.

const DAY_MS = 24 * 60 * 60 * 1000

export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS)

/** `<input type="date">` için yerel gün (YYYY-MM-DD) — toISOString UTC'ye kayar. */
export const toDateInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

/**
 * YYYY-MM-DD — MÜKELLEFİN takvim günü (Europe/Istanbul).
 *
 * `toDateInput` TARAYICI için: kullanıcının kendi saatine göre gün verir ve form
 * kutularında doğrusu odur. SUNUCUDA aynısı kullanılamaz — Vercel UTC'de koşar,
 * yerel gün UTC günü olur ve TSİ 00:00-03:00 arasındaki işlem bir önceki güne
 * yazılır. Sunucudan bir güne karar veriliyorsa (belge tarihi, sağlayıcıya giden
 * `docDate`) saat dilimi AÇIKÇA verilmelidir.
 */
export const istanbulDay = (date: Date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(date)

/**
 * Tutar kutusuna yalnız rakam ve ondalık/binlik ayracı girilebilsin.
 *
 * Serbest metin kabul edildiğinde sonuç görünenden kötüydü: "abc" sunucuya gidiyor,
 * sayıya çevrilemediği için filtre SESSİZCE düşüyordu — rozet "3 filtre" derken
 * yalnız biri uygulanıyordu. Karakteri kapıda kesmek hatayı en başta engelliyor.
 */
export const sanitizeAmountInput = (raw: string) => raw.replace(/[^\d.,]/g, "")

/**
 * Kutudaki metni API'ye gidecek tek biçime çevirir ("1.500,50" → "1500.5").
 * Çözülemeyen değer boş döner, yani istek parametresi hiç eklenmez.
 */
export const canonicalAmount = (raw: string) => {
  const value = parseTrNumber(raw)
  return value === null ? "" : String(value)
}

const THOUSANDS_DOT = /^[1-9]\d{0,2}(\.\d{3})+$/

/**
 * Binlik ayracını da çözen sayı ayrıştırıcı — GEÇERSİZ girdide `null`.
 *
 * `parseNum`den farkı gruplamayı anlaması ("1.500,50" → 1500,5). `parseAmount`
 * (lib/satis/payment.ts) farkı ise POLİTİKASIZ olması: geçersiz girdiyi 0'a
 * düşürmez. Filtre kutusunda bu ayrım şart — "0" gerçek bir alt sınır, "abc" ise
 * hata; ikisini aynı sayıya indirgemek filtreyi sessizce düşürür.
 *
 * Kural (tr öncelikli):
 *  - İki ayraç da varsa SONUNCUSU ondalıktır: "1.500,50" da "1,500.50" da 1500,5.
 *  - Yalnız virgül varsa ondalıktır ("12,50"); birden çok virgül gruplamadır
 *    ("1,000,000" → 1000000).
 *  - Yalnız nokta varsa üçlü gruplanmışsa binliktir ("1.500" → 1500), değilse
 *    ondalık ("12.50" → 12,5). Baştaki grup 0 ise ondalık sayılır ("0.500" → 0,5).
 *  - Boşluk/₺ gibi karakterler atılır; geriye rakam kalmazsa null.
 */
export function parseTrNumber(v: string | number | null | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null

  const text = String(v ?? "").trim()
  const negative = text.startsWith("-")
  const raw = text.replace(/[^\d.,]/g, "")
  if (!raw) return null

  const dots = raw.split(".").length - 1
  const commas = raw.split(",").length - 1

  let normalized: string
  if (dots > 0 && commas > 0) {
    const decimal = raw.lastIndexOf(".") > raw.lastIndexOf(",") ? "." : ","
    const thousands = decimal === "." ? "," : "."
    normalized = raw.split(thousands).join("")
    normalized = decimal === "," ? normalized.replace(/,([^,]*)$/, ".$1") : normalized
  } else if (commas > 0) {
    normalized = commas > 1 ? raw.split(",").join("") : raw.replace(",", ".")
  } else {
    normalized = THOUSANDS_DOT.test(raw) ? raw.split(".").join("") : raw
  }

  const n = parseFloat(normalized)
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

/**
 * Tutarı ürünün KENDİ para birimiyle biçimler (₺/$/€). Geçersiz/eksik kodda TRY'ye düşer.
 *
 * `money`den farkı: para birimi çağıranın verdiği alandan gelir. Ürün kartında
 * `currency` alanı var ve fiyat O cinsten; sabit TRY ile basmak 100 $'lık ürünü
 * ekranda "100 ₺" gösterir — kullanıcı da ürünü o fiyata satar.
 *
 * `signed` kâr/fark gibi işaretin anlamlı olduğu yerlerde `+`/`−` ekler.
 */
export function formatMoney(amount: number, currency?: string | null, signed = false): string {
  const cur = (currency || "TRY").toUpperCase()
  const opts: Intl.NumberFormatOptions = {
    style: "currency",
    currency: ["TRY", "USD", "EUR"].includes(cur) ? cur : "TRY",
    currencyDisplay: "narrowSymbol",
  }
  if (signed) opts.signDisplay = "exceptZero"
  return new Intl.NumberFormat("tr-TR", opts).format(Number.isFinite(amount) ? amount : 0)
}

// --- Türkçe rakam → yazı ---
//
// Faturanın "Yalnız: …" satırı ve otomatik kesilen belgelerin NOT satırları aynı
// metni kullanır. Önce lib/pdf/gib-invoice-pdf.ts içindeydi; belge kesen sunucu yolu
// yalnız bir sayı yazısı için pdfmake yüklemesin diye buraya alındı (PDF tarafı
// `amountInWords`i buradan yeniden dışa verir).

const ONES = ["", "BİR", "İKİ", "ÜÇ", "DÖRT", "BEŞ", "ALTI", "YEDİ", "SEKİZ", "DOKUZ"]
const TENS = ["", "ON", "YİRMİ", "OTUZ", "KIRK", "ELLİ", "ALTMIŞ", "YETMİŞ", "SEKSEN", "DOKSAN"]
const SCALES = ["", "BİN", "MİLYON", "MİLYAR", "TRİLYON"]

function threeDigitsToWords(n: number): string {
  const parts: string[] = []
  const h = Math.floor(n / 100)
  const t = Math.floor((n % 100) / 10)
  const o = n % 10
  if (h > 0) parts.push(h === 1 ? "YÜZ" : `${ONES[h]} YÜZ`)
  if (t > 0) parts.push(TENS[t])
  if (o > 0) parts.push(ONES[o])
  return parts.join(" ").trim()
}

export function integerToTurkishWords(value: number): string {
  let n = Math.floor(Math.abs(value))
  if (n === 0) return "SIFIR"
  const groups: number[] = []
  while (n > 0) {
    groups.push(n % 1000)
    n = Math.floor(n / 1000)
  }
  const words: string[] = []
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]
    if (g === 0) continue
    // "BİR BİN" yerine "BİN" yazılır (yalnız binler basamağında).
    if (i === 1 && g === 1) {
      words.push(SCALES[i])
    } else {
      words.push(`${threeDigitsToWords(g)} ${SCALES[i]}`.trim())
    }
  }
  return words.join(" ").replace(/\s+/g, " ").trim()
}

/** "Yalnız: ÜÇ YÜZ ON İKİ TL ELLİ KR" — belgede ve fatura notunda aynı metin. */
export function amountInWords(amount: number, currency = "TRY"): string {
  const safe = Number(amount) || 0
  const lira = Math.floor(safe)
  const kurus = Math.round((safe - lira) * 100)
  const curLabel = currency === "TRY" ? "TL" : currency
  const liraWords = integerToTurkishWords(lira)
  if (kurus > 0) {
    return `Yalnız: ${liraWords} ${curLabel} ${integerToTurkishWords(kurus)} KR`
  }
  return `Yalnız: ${liraWords} ${curLabel}`
}
