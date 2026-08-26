// İndirim kodu gövdesinin doğrulanması — ekleme (POST) ve düzenleme (PUT) ortak.
//
// Ayrı dosyada: iki uç aynı kuralları uygulamalı. Kural kopyalanırsa düzenleme,
// eklemede engellenen bir değeri (ör. %150 indirim) arka kapıdan içeri alır.

export type DiscountCodeData = {
  description: string | null
  type: string
  value: number
  scope: string
  maxDiscount: number | null
  minAmount: number | null
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

function optionalDate(v: unknown): Date | null {
  if (v == null || String(v).trim() === "") return null
  const d = new Date(String(v))
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

  const startsAt = optionalDate(body?.startsAt)
  const endsAt = optionalDate(body?.endsAt)
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

  const maxDiscount = optionalNumber(body?.maxDiscount)
  if (maxDiscount != null && maxDiscount <= 0) {
    return { ok: false, error: "İndirim tavanı pozitif olmalı" }
  }
  const minAmount = optionalNumber(body?.minAmount)
  if (minAmount != null && minAmount < 0) {
    return { ok: false, error: "Asgari tutar negatif olamaz" }
  }

  void opts // ileride kısmi güncelleme gerekirse ayrım burada yapılır

  return {
    ok: true,
    data: {
      description: body?.description ? String(body.description).trim() : null,
      type,
      value,
      scope,
      // Tavan yalnız yüzde indirimde anlamlı; sabit tutarda değer zaten tavandır.
      maxDiscount: type === "PERCENT" ? maxDiscount : null,
      minAmount,
      startsAt,
      endsAt,
      maxRedemptions,
      maxPerCompany,
      appliesToRenewals: Boolean(body?.appliesToRenewals),
      isActive: body?.isActive == null ? true : Boolean(body.isActive),
    },
  }
}
