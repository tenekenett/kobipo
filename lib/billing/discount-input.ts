// İndirim kodu gövdesinin doğrulanması — ekleme (POST) ve düzenleme (PUT) ortak.
//
// Ayrı dosyada: iki uç aynı kuralları uygulamalı. Kural kopyalanırsa düzenleme,
// eklemede engellenen bir değeri (ör. %150 indirim) arka kapıdan içeri alır.

export type DiscountCodeData = {
  description: string | null
  type: string
  value: number
  scope: string
  startsAt: Date | null
  endsAt: Date | null
  maxRedemptions: number | null
  maxPerCompany: number | null
  appliesToRenewals: boolean
  isActive: boolean
}

export type ParseResult =
  | { ok: true; data: DiscountCodeData }
  | { ok: false; error: string }

const TYPES = new Set(["PERCENT", "AMOUNT"])
const SCOPES = new Set(["ALL", "KONTOR", "PACKAGE"])

function optionalNumber(v: unknown): number | null {
  if (v == null || String(v).trim() === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Türkiye sabit UTC+03:00 — 2016'dan beri yaz saati uygulaması yok, bu yüzden
 * sabit ofset yıl boyunca doğrudur.
 */
const TR_UTC_OFFSET = "+03:00"
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Kampanya penceresinin ucunu çözer.
 *
 * TARİH-ONLY TUZAĞI: panelin `<input type="date">` alanı "2026-08-28" verir ve
 * `new Date("2026-08-28")` bunu **UTC** gece yarısı sayar. Türkiye'de bu 28 Ağustos
 * 03:00 demektir; `now > endsAt` denetimi kuponu o günün sabahında öldürür ve
 * "28 Ağustos'a kadar geçerli" denen kod o günü hiç göremez. Başlangıç da 3 saat
 * geç açılır, aynı güne kurulan tek günlük kampanya ise sıfır uzunlukta kalır.
 *
 * Bu yüzden tarih-only girdi Türkiye gününün SINIRLARINA sabitlenir: başlangıç
 * günün ilk anına, bitiş son anına (23:59:59.999). Saat içeren tam bir zaman
 * damgası geldiyse olduğu gibi bırakılır — çağıran bilerek an vermiştir.
 */
function optionalDate(v: unknown, edge: "start" | "end"): Date | null {
  if (v == null || String(v).trim() === "") return null
  const raw = String(v).trim()
  const iso = DATE_ONLY.test(raw)
    ? `${raw}T${edge === "end" ? "23:59:59.999" : "00:00:00.000"}${TR_UTC_OFFSET}`
    : raw
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

export function parseDiscountCodeInput(
  body: any,
  opts: { requireAll: boolean },
): ParseResult {
  const type = String(body?.type ?? "").toUpperCase()
  if (!TYPES.has(type)) return { ok: false, error: "İndirim tipi PERCENT veya AMOUNT olmalı" }

  const value = Number(body?.value)
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: "İndirim değeri pozitif olmalı" }
  }
  // Yüzde 100'ü aşarsa tutar negatife düşerdi; sınır burada, tek yerde.
  if (type === "PERCENT" && value > 100) {
    return { ok: false, error: "Yüzde indirim en fazla %100 olabilir" }
  }

  const scope = String(body?.scope ?? "ALL").toUpperCase()
  if (!SCOPES.has(scope)) return { ok: false, error: "Kapsam ALL, KONTOR veya PACKAGE olmalı" }

  const startsAt = optionalDate(body?.startsAt, "start")
  const endsAt = optionalDate(body?.endsAt, "end")
  if (startsAt && endsAt && endsAt < startsAt) {
    return { ok: false, error: "Bitiş tarihi başlangıçtan önce olamaz" }
  }

  const maxRedemptions = optionalNumber(body?.maxRedemptions)
  if (maxRedemptions != null && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1)) {
    return { ok: false, error: "Toplam kullanım hakkı pozitif tam sayı olmalı" }
  }
  const maxPerCompany = optionalNumber(body?.maxPerCompany)
  if (maxPerCompany != null && (!Number.isInteger(maxPerCompany) || maxPerCompany < 1)) {
    return { ok: false, error: "Firma başına hak pozitif tam sayı olmalı" }
  }

  void opts // ileride kısmi güncelleme gerekirse ayrım burada yapılır

  return {
    ok: true,
    data: {
      description: body?.description ? String(body.description).trim() : null,
      type,
      value,
      scope,
      startsAt,
      endsAt,
      maxRedemptions,
      maxPerCompany,
      appliesToRenewals: Boolean(body?.appliesToRenewals),
      isActive: body?.isActive == null ? true : Boolean(body.isActive),
    },
  }
}
