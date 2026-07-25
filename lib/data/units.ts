// Ürün/hizmet birim seçenekleri. value = saklanan kod (mevcut verilerle uyumlu,
// büyük harf), label = kullanıcıya gösterilen okunaklı ad.
export const UNIT_OPTIONS: { value: string; label: string }[] = [
  { value: "ADET", label: "Adet" },
  { value: "KG", label: "Kilogram (kg)" },
  { value: "GR", label: "Gram (g)" },
  { value: "TON", label: "Ton" },
  { value: "LT", label: "Litre (lt)" },
  { value: "ML", label: "Mililitre (ml)" },
  { value: "MT", label: "Metre (m)" },
  { value: "CM", label: "Santimetre (cm)" },
  { value: "M2", label: "Metrekare (m²)" },
  { value: "M3", label: "Metreküp (m³)" },
  { value: "PAKET", label: "Paket" },
  { value: "KUTU", label: "Kutu" },
  { value: "KOLI", label: "Koli" },
  { value: "DESTE", label: "Deste" },
  { value: "ÇİFT", label: "Çift" },
  { value: "RULO", label: "Rulo" },
  { value: "SAAT", label: "Saat" },
  { value: "GÜN", label: "Gün" },
  { value: "HAFTA", label: "Hafta" },
  { value: "AY", label: "Ay" },
  { value: "YIL", label: "Yıl" },
]

/**
 * UBL/GİB birim kodu (ör. e-faturalarda gelen "C62", "MTR", "KGM") ve serbest
 * Türkçe birim adlarını, uygulamanın sakladığı birim değerine (UNIT_OPTIONS.value)
 * çevirir. Gelen e-fatura alış faturasına dönüştürülürken birim "Adet/Metre..."
 * olarak doğru işlensin diye kullanılır.
 */
const UBL_UNIT_CODE_MAP: Record<string, string> = {
  // Adet / birim
  C62: "ADET",
  NIU: "ADET",
  PCE: "ADET",
  EA: "ADET",
  H87: "ADET",
  XUN: "ADET",
  // Ağırlık
  KGM: "KG",
  GRM: "GR",
  TNE: "TON",
  // Hacim (sıvı)
  LTR: "LT",
  MLT: "ML",
  // Uzunluk
  MTR: "MT",
  CMT: "CM",
  // Alan / hacim
  MTK: "M2",
  MTQ: "M3",
  // Paketleme
  PR: "ÇİFT",
  NPR: "ÇİFT",
  ROL: "RULO",
  PK: "PAKET",
  XPK: "PAKET",
  PA: "PAKET",
  BX: "KUTU",
  XBX: "KUTU",
  CT: "KOLI",
  XCT: "KOLI",
  CS: "KOLI",
  // Zaman
  HUR: "SAAT",
  DAY: "GÜN",
  WEE: "HAFTA",
  MON: "AY",
  ANN: "YIL",
}

/** Türkçe karakterleri sadeleştirir (eşleştirme anahtarı üretmek için). */
function normTrUnit(s: string): string {
  return s
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]/g, "")
    .trim()
}

// Serbest yazılmış Türkçe/uzun birim adları → uygulama değeri.
const TR_UNIT_SYNONYMS: Record<string, string> = {
  adet: "ADET",
  ad: "ADET",
  kilogram: "KG",
  kg: "KG",
  kilo: "KG",
  gram: "GR",
  gr: "GR",
  ton: "TON",
  litre: "LT",
  lt: "LT",
  l: "LT",
  mililitre: "ML",
  ml: "ML",
  metre: "MT",
  mt: "MT",
  m: "MT",
  santimetre: "CM",
  cm: "CM",
  metrekare: "M2",
  m2: "M2",
  metrekup: "M3",
  m3: "M3",
  paket: "PAKET",
  kutu: "KUTU",
  koli: "KOLI",
  deste: "DESTE",
  cift: "ÇİFT",
  rulo: "RULO",
  saat: "SAAT",
  sa: "SAAT",
  gun: "GÜN",
  hafta: "HAFTA",
  ay: "AY",
  yil: "YIL",
}

const UNIT_VALUE_SET = new Set(UNIT_OPTIONS.map((u) => u.value))

export function normalizeUnitCode(raw?: string | null): string {
  if (raw == null) return ""
  const trimmed = String(raw).trim()
  if (!trimmed) return ""
  const upper = trimmed.toUpperCase()
  // Zaten geçerli uygulama birimiyse (ör. "ADET", "MT") olduğu gibi koru.
  if (UNIT_VALUE_SET.has(upper)) return upper
  // UBL/GİB birim kodu eşleşmesi.
  if (UBL_UNIT_CODE_MAP[upper]) return UBL_UNIT_CODE_MAP[upper]
  // Serbest Türkçe/uzun ad eşleşmesi.
  const key = normTrUnit(trimmed)
  if (TR_UNIT_SYNONYMS[key]) return TR_UNIT_SYNONYMS[key]
  // Bilinmiyorsa orijinali koru (kullanıcı görüp düzeltebilir; bilgi kaybolmaz).
  return trimmed
}

/* ------------------------------------------------------------------ *
 * Birim dönüşümü (reçete → stok)
 * ------------------------------------------------------------------ */

/**
 * Birim ailesi ve taban birime çarpanı. Reçete bileşeni, hammaddenin stok
 * biriminden FARKLI bir birimde yazılabilsin diye var: süt LT olarak stoklanır
 * ama reçetede 200 ML geçer, kahve KG stoklanır reçetede 20 GR geçer.
 *
 * Yalnızca AYNI aile içinde dönüşüm yapılır. Aile dışı dönüşüm (ADET ↔ GR)
 * fiziksel olarak tanımsızdır — "1 paket = 250 gr" gibi paket boyu kavramı
 * bilinçli olarak kapsam dışı. Bu yüzden ADET/PAKET/KUTU/KOLI ve zaman
 * birimleri burada yer almaz; onlar yalnızca kendileriyle eşleşir.
 *
 * M2/M3 de listede yok: aileleri tek üyeli olduğundan dönüştürülecek bir
 * karşılıkları yok, kimlik durumu (from === to) zaten aşağıda ele alınıyor.
 */
const UNIT_FAMILIES: Record<string, { family: string; toBase: number }> = {
  // Ağırlık — taban: GR
  GR: { family: "mass", toBase: 1 },
  KG: { family: "mass", toBase: 1_000 },
  TON: { family: "mass", toBase: 1_000_000 },
  // Hacim — taban: ML
  ML: { family: "volume", toBase: 1 },
  LT: { family: "volume", toBase: 1_000 },
  // Uzunluk — taban: CM
  CM: { family: "length", toBase: 1 },
  MT: { family: "length", toBase: 100 },
}

/** Birimin ait olduğu aile ("mass" | "volume" | "length"); tanımsızsa null. */
export function unitFamily(unit?: string | null): string | null {
  const u = normalizeUnitCode(unit)
  return UNIT_FAMILIES[u]?.family ?? null
}

/**
 * İki birim arasında dönüşüm yapılabilir mi? Aynı birim her zaman dönüşebilir
 * (kimlik); farklı birimler yalnızca aynı aileye aitse dönüşebilir.
 */
export function canConvert(from?: string | null, to?: string | null): boolean {
  const f = normalizeUnitCode(from)
  const t = normalizeUnitCode(to)
  if (!f || !t) return false
  if (f === t) return true
  const a = UNIT_FAMILIES[f]
  const b = UNIT_FAMILIES[t]
  return Boolean(a && b && a.family === b.family)
}

/**
 * `qty` miktarını `from` biriminden `to` birimine çevirir.
 * Dönüşüm tanımsızsa null döner — çağıran tarafın bunu HATA olarak ele alması
 * beklenir (sessizce 0 kabul etmek stoğu bozar).
 *
 * Kayan nokta gürültüsü burada yuvarlanmaz; nihai yuvarlama, miktarın stoğa
 * yazıldığı noktada (4 ondalık) yapılır.
 */
export function convertUnit(
  qty: number,
  from?: string | null,
  to?: string | null
): number | null {
  if (!Number.isFinite(qty)) return null
  const f = normalizeUnitCode(from)
  const t = normalizeUnitCode(to)
  if (!f || !t) return null
  if (f === t) return qty
  const a = UNIT_FAMILIES[f]
  const b = UNIT_FAMILIES[t]
  if (!a || !b || a.family !== b.family) return null
  return (qty * a.toBase) / b.toBase
}

/**
 * Verilen birimle uyumlu (aynı aile) birim seçeneklerini döndürür. Reçete
 * formunda bileşen birimi seçilirken listeyi daraltmak için kullanılır;
 * böylece kullanıcı en baştan dönüştürülemeyecek bir birim seçemez.
 */
export function convertibleUnits(unit?: string | null): string[] {
  const u = normalizeUnitCode(unit)
  if (!u) return []
  const family = UNIT_FAMILIES[u]?.family
  if (!family) return [u] // aile dışı birim yalnızca kendisiyle eşleşir
  return Object.keys(UNIT_FAMILIES).filter((k) => UNIT_FAMILIES[k].family === family)
}
