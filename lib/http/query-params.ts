/**
 * Query parametresi doğrulama — geçersiz tarih/sayıda 400, ASLA 500.
 *
 * 2026-09-18 uçtan uca taramada 20 uç `startDate=abc`, `year=999999999999`,
 * `month=2026-13-45` gibi girdilerde 500 dönüyordu: kök neden hep aynı,
 * `new Date("abc")` → Invalid Date → Prisma `where` ifadesinde patlıyor. Biri
 * (`/api/faturalar`) ham Prisma sorgusunu gövdeye sızdırıyordu. Doğrusu: parametre
 * uca girerken doğrulanır, geçersizse anlaşılır bir 400 döner.
 *
 * `BadRequestError` `lib/api/errors.ts` içinde 400'e maplenir (withApiErrors +
 * `badRequestFrom`). Uçların KENDİ catch'i varsa oraya da `badRequestFrom` dalı
 * eklenmeli — yoksa iç catch hatayı önce yakalar ve 500'e çevirir.
 */

export const BAD_REQUEST_CODE = "BAD_REQUEST" as const

export class BadRequestError extends Error {
  readonly code = BAD_REQUEST_CODE
  constructor(message: string) {
    super(message)
    this.name = "BadRequestError"
  }
}

export function badRequestFrom(error: unknown): BadRequestError | null {
  return error instanceof BadRequestError ? error : null
}

/**
 * ISO ya da `YYYY-MM-DD` bir tarih parametresini doğrular.
 * @returns girdinin kendisi (downstream `new Date()`'e verilebilir) ya da yok/boşsa null.
 * @throws BadRequestError present-but-invalid ise.
 */
export function parseDateParam(value: string | null | undefined, name: string): string | null {
  const raw = typeof value === "string" ? value.trim() : ""
  if (!raw) return null
  // ISO biçim ŞART: `YYYY-MM-DD` ya da tam ISO. Yoksa `new Date("-1")` gibi girdiler
  // (2000-12-31 olarak "geçerli") doğrulamadan geçip downstream'de patlıyordu — bir
  // rapor ucu endDate'e "T23:59:59.999" ekleyince `new Date("-1T…")` Invalid oluyordu.
  // Tarih SÜZGECİ zaten yalnız bu biçimi alır; gevşek sayıları reddetmek doğru.
  if (!/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(raw)) {
    throw new BadRequestError(`${name} geçerli bir tarih olmalı (örn. 2026-01-31).`)
  }
  if (Number.isNaN(new Date(raw).getTime())) {
    throw new BadRequestError(`${name} geçerli bir tarih olmalı (örn. 2026-01-31).`)
  }
  return raw
}

/** Tarih parametresini doğrulayıp Date döndürür (null = yok). */
export function parseDateValue(value: string | null | undefined, name: string): Date | null {
  const raw = parseDateParam(value, name)
  return raw == null ? null : new Date(raw)
}

/**
 * Tamsayı parametresi (yıl/ay vb.). Boş → null. Sayı değilse ya da aralık dışıysa 400.
 */
export function parseIntParam(
  value: string | null | undefined,
  name: string,
  opts: { min?: number; max?: number } = {},
): number | null {
  const raw = typeof value === "string" ? value.trim() : ""
  if (!raw) return null
  if (!/^-?\d+$/.test(raw)) {
    throw new BadRequestError(`${name} bir tam sayı olmalı.`)
  }
  const n = Number(raw)
  if (!Number.isSafeInteger(n)) {
    throw new BadRequestError(`${name} geçersiz.`)
  }
  if (opts.min != null && n < opts.min) {
    throw new BadRequestError(`${name} en az ${opts.min} olmalı.`)
  }
  if (opts.max != null && n > opts.max) {
    throw new BadRequestError(`${name} en çok ${opts.max} olmalı.`)
  }
  return n
}

/** Yıl parametresi (2000–2100). */
export function parseYearParam(value: string | null | undefined, name = "year"): number | null {
  return parseIntParam(value, name, { min: 2000, max: 2100 })
}

/** Ay parametresi (1–12). */
export function parseMonthParam(value: string | null | undefined, name = "month"): number | null {
  return parseIntParam(value, name, { min: 1, max: 12 })
}
