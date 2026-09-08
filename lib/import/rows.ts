/**
 * İçe aktarım satırlarının VERİTABANISIZ kuralları: başlık eşleme, sayı
 * ayrıştırma, mevcut kayıtla eşleştirme ve "hangi alanlar yazılacak" kararı.
 *
 * Uç (`app/api/import/route.ts`) yalnızca sorgu/yazma yapar; kural burada durur
 * ve `lib/import/rows.test.ts` ile sınanır. Kuralı uca geri taşımayın: içe
 * aktarımın sınanabilir tek yeri burasıdır.
 */

export type ImportGetter = (key: string) => string

export function normalizeHeader(value: string) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
}

export function normalizeTaxNumber(value: string | null | undefined) {
  return String(value || "").replace(/\D/g, "")
}

export function parseDecimal(value: any, fallback = 0) {
  const raw = String(value ?? "").trim()
  if (!raw) return fallback

  const normalized = raw
    .replace(/\s+/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(/,(?=\d{3}(\D|$))/g, "")
    .replace(",", ".")

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function parseOpeningBalanceType(value: string) {
  const normalized = normalizeHeader(value)
  if (["alacak", "credit", "c"].includes(normalized)) return "CREDIT"
  return "DEBIT"
}

/**
 * Başlık takma adları.
 *
 * Şablondaki adların YANINDA dışa aktarımın (`lib/export/datasets/*`) yazdığı
 * başlıklar da bulunur: kullanıcının ilk yolu listeyi Excel'e aktarıp düzeltip
 * geri yüklemektir. Dışa aktarım "Ürün Adı" yazarken içe aktarım yalnız "Ad"
 * tanısaydı o dosyanın HER satırı "name is required" ile düşerdi.
 */
export const customerHeaderAliases: Record<string, string[]> = {
  code: ["code", "kod"],
  name: ["name", "ad", "unvan", "musteriunvani", "tedarikciunvani", "cariunvani"],
  taxnumber: ["taxnumber", "vergino", "vkn", "tckn", "vkntckn"],
  taxoffice: ["taxoffice", "vergidairesi"],
  phone: ["phone", "telefon"],
  email: ["email", "eposta", "mail"],
  address: ["address", "adres"],
  city: ["city", "sehir", "il"],
  contactperson: ["contactperson", "yetkilikisi", "yetkili"],
  paymentduedays: ["paymentduedays", "vadegun", "vade"],
  openingbalance: ["openingbalance", "acilisbakiyesi"],
  openingbalancetype: ["openingbalancetype", "bakiyeturu"],
  risklimit: ["risklimit", "risklimiti"],
  bankinfo: ["bankinfo", "bankabilgisi"],
  note: ["note", "not"],
}

export const supplierHeaderAliases: Record<string, string[]> = {
  ...customerHeaderAliases,
}

export const productHeaderAliases: Record<string, string[]> = {
  code: ["code", "kod"],
  name: ["name", "ad", "urunadi"],
  barcode: ["barcode", "barkod"],
  shelfcode: ["shelfcode", "rafno", "raf"],
  category: ["category", "kategori"],
  unit: ["unit", "birim"],
  // "Depo Stoğu": dışa aktarım depo süzgeciyle alındığında başlık böyle gelir.
  stockquantity: ["stockquantity", "stokmiktari", "stok", "depostogu"],
  minstocklevel: ["minstocklevel", "minstok", "minimumstok"],
  purchaseprice: ["purchaseprice", "alisfiyati"],
  saleprice: ["saleprice", "satisfiyati"],
  vatrate: ["vatrate", "kdvorani", "kdv"],
}

export const invoiceHeaderAliases: Record<string, string[]> = {
  invoiceno: ["invoiceno", "faturano"],
  date: ["date", "tarih"],
  type: ["type", "tip"],
  invoicetype: ["invoicetype", "faturatipi"],
  netamount: ["netamount", "nettutar"],
  vatamount: ["vatamount", "kdvtutari"],
  totalamount: ["totalamount", "toplamtutar"],
  currency: ["currency", "parabirimi"],
  notes: ["notes", "aciklama", "notlar"],
}

/** `headers` NORMALLEŞTİRİLMİŞ başlık dizisidir (bkz. normalizeHeader). */
export function readCell(
  headers: string[],
  row: string[],
  aliases: Record<string, string[]>,
  key: string,
): string {
  const candidates = aliases[key] || [key]
  for (const candidate of candidates) {
    const index = headers.indexOf(candidate)
    if (index >= 0) return String(row[index] ?? "").trim()
  }
  return ""
}

/* ------------------------------------------------------------------ *
 * Mevcut kayıtla eşleştirme
 * ------------------------------------------------------------------ */

export type MatchRule<T> = {
  /** Hata metninde geçen anahtarın adı: "ad", "barkod", "kod"... */
  by: string
  /** Satırdan gelen değer; boşsa kural atlanır. */
  value: string
  of: (record: T) => string | null | undefined
}

export type MatchOutcome<T> =
  | { status: "new" }
  | { status: "match"; record: T; by: string }
  | { status: "conflict"; hits: Array<{ by: string; record: T }> }

function comparable(value: string | null | undefined) {
  return String(value ?? "").trim().toLocaleLowerCase("tr-TR")
}

/**
 * Satırın hangi mevcut kayda denk düştüğünü ÖNCELİK SIRASIYLA çözer; sıra
 * `rules` dizisinin sırasıdır (ürün için: ad → barkod → kod).
 *
 * Ad neden önce: kullanıcı listeyi çoğu zaman kod/barkod sütunu boşken hazırlar
 * ya da o sütunları sonradan doldurur. Kod öncelikli olsaydı kodsuz satır "yeni
 * ürün" sayılıp aynı ürün ikinci kez açılırdı.
 *
 * İki anahtar FARKLI kayıtlara işaret ediyorsa (ad A'yı, barkod B'yi tutuyor)
 * karar verilmez: `conflict` döner ve satır hataya yazılır. Önceliğe bakıp
 * birini seçmek, kullanıcının B'nin barkodunu A'ya taşıdığını sessizce
 * onaylamak olurdu.
 */
export function pickMatch<T extends { id: string }>(
  candidates: T[],
  rules: Array<MatchRule<T>>,
): MatchOutcome<T> {
  const hits: Array<{ by: string; record: T }> = []

  for (const rule of rules) {
    const value = comparable(rule.value)
    if (!value) continue
    const record = candidates.find((candidate) => comparable(rule.of(candidate)) === value)
    if (record) hits.push({ by: rule.by, record })
  }

  if (hits.length === 0) return { status: "new" }

  const distinctIds = new Set(hits.map((hit) => hit.record.id))
  if (distinctIds.size > 1) return { status: "conflict", hits }

  return { status: "match", record: hits[0].record, by: hits[0].by }
}

export function describeMatchConflict<T extends { name: string }>(
  hits: Array<{ by: string; record: T }>,
): string {
  const parts = hits.map((hit) => `${hit.by} → "${hit.record.name}"`)
  return `Satır birden fazla kayıtla eşleşti (${parts.join(", ")}); hangisinin güncelleneceği belirsiz`
}

/* ------------------------------------------------------------------ *
 * Güncelleme gövdeleri — BOŞ HÜCRE "DEĞİŞTİRME" DEMEKTİR
 * ------------------------------------------------------------------ */

/**
 * Yalnızca dosyada DOLU gelen sütunları yazar.
 *
 * Boş hücreyi "null yap" saymak, fiyat güncellemek için gönderilen dar bir
 * dosyanın (Ad + Satış Fiyatı) kartlardaki barkod/raf/vergi dairesini silmesi
 * demek olurdu. Bu yüzden içe aktarımla alan BOŞALTILAMAZ; boşaltma kart
 * ekranından yapılır.
 */
function collectProvided(entries: Array<[string, string, (raw: string) => unknown]>) {
  const data: Record<string, unknown> = {}
  for (const [field, raw, map] of entries) {
    if (raw !== "") data[field] = map(raw)
  }
  return data
}

export type UpdateOptions = {
  /**
   * Satır kayda ADIYLA denk geldiyse ad YAZILMAZ.
   *
   * Eşleştirme büyük/küçük harfe bakmıyor; ad yine de yazılsaydı ürünleri
   * "ELMA" diye yazan bir fiyat listesi bütün kartları büyük harfe çevirirdi —
   * kullanıcı yalnız fiyat güncellediğini sanırken. Barkod/koda göre eşleşen
   * satırda ise ad KASITLI bir yeniden adlandırmadır ve yazılır.
   */
  matchedByName: boolean
}

export function productUpdateData(
  get: ImportGetter,
  options: UpdateOptions & { updateStock: boolean },
) {
  const data = collectProvided([
    ["name", options.matchedByName ? "" : get("name"), (raw) => raw],
    ["code", get("code"), (raw) => raw],
    ["barcode", get("barcode"), (raw) => raw],
    ["shelfCode", get("shelfcode"), (raw) => raw],
    ["category", get("category"), (raw) => raw],
    ["unit", get("unit"), (raw) => raw],
    ["minStockLevel", get("minstocklevel"), (raw) => parseDecimal(raw, 0)],
    ["purchasePrice", get("purchaseprice"), (raw) => parseDecimal(raw)],
    ["salePrice", get("saleprice"), (raw) => parseDecimal(raw)],
    ["vatRate", get("vatrate"), (raw) => parseDecimal(raw, 20)],
  ])

  // Stok miktarı VARSAYILAN OLARAK yazılmaz: dosyadaki sayı dışa aktarım
  // anındaki bakiyedir ve aradaki irsaliye/fatura/sayım hareketlerini geri
  // alır. Fiyat güncelleyen kullanıcı stoğunu geri sarmış olmamalı.
  if (options.updateStock) {
    const raw = get("stockquantity")
    if (raw !== "") data.stockQuantity = parseDecimal(raw, 0)
  }

  return data
}

export function cariUpdateData(get: ImportGetter, options: UpdateOptions) {
  const data = collectProvided([
    ["name", options.matchedByName ? "" : get("name"), (raw) => raw],
    ["code", get("code"), (raw) => raw],
    ["taxNumber", get("taxnumber"), (raw) => raw],
    ["taxOffice", get("taxoffice"), (raw) => raw],
    ["phone", get("phone"), (raw) => raw],
    ["email", get("email"), (raw) => raw],
    ["address", get("address"), (raw) => raw],
    ["city", get("city"), (raw) => raw],
    ["contactPerson", get("contactperson"), (raw) => raw],
    ["paymentDueDays", get("paymentduedays"), (raw) => Math.max(0, Math.trunc(parseDecimal(raw, 0)))],
    ["riskLimit", get("risklimit"), (raw) => parseDecimal(raw, 0)],
    ["bankInfo", get("bankinfo"), (raw) => raw],
    ["note", get("note"), (raw) => raw],
  ])

  // Bakiye türü tek başına anlamsızdır ve boşken DEBIT'e düşer; tutar
  // gelmediyse yazılmaz, yoksa "Alacak" bir cari sessizce "Borç" olurdu.
  const openingBalance = get("openingbalance")
  if (openingBalance !== "") {
    data.openingBalanceAmount = parseDecimal(openingBalance, 0)
    data.openingBalanceType = parseOpeningBalanceType(get("openingbalancetype"))
  }

  return data
}
