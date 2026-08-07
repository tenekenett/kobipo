/**
 * Vardiya uçlarının ortak parçaları.
 *
 * Ayrı dosyada, çünkü Next route dosyaları yalnız HTTP metodu ve yapılandırma
 * dışa aktarabilir — yardımcıları `route.ts` içinde export etmek derlemeyi kırar.
 * Liste, tekil ve toplu uçlar aynı doğrulama ve aynı DTO'yu kullanmalı; ikisi
 * ayrışırsa takvim bir uçtan gelen kaydı çizip diğerinden geleni çizemez.
 */

import { prisma } from "@/lib/db/prisma"
import { MAX_MINUTE, MIN_SHIFT_MINUTES, dayToUtcDate, overlaps, utcDateToDay } from "@/lib/personel/vardiya"

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export const EMPLOYEE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  department: true,
  position: true,
} as const

type ShiftRow = {
  id: string
  employeeId: string
  workDate: Date
  plannedStart: number
  plannedEnd: number
  actualStart: number | null
  actualEnd: number | null
  breakMinutes: number
  status: string
  note: string | null
  templateId: string | null
  employee?: {
    id: string
    firstName: string
    lastName: string
    department: string | null
    position: string | null
  }
  template?: { name: string; color: string | null } | null
}

/**
 * Vardiya sorgularının ortak include'u. Tek yerde: bir uç şablonu çekmeyi
 * unutursa o uçtan gelen barlar renksiz kalır ve ekranlar arasında fark oluşur.
 */
export const SHIFT_INCLUDE = {
  employee: { select: EMPLOYEE_SELECT },
  template: { select: { name: true, color: true } },
} as const

/** Kayıt → istemcinin beklediği düz şekil. `workDate` "YYYY-MM-DD" olarak gider. */
export const toShiftDto = (s: ShiftRow) => ({
  id: s.id,
  employeeId: s.employeeId,
  workDate: utcDateToDay(s.workDate),
  plannedStart: s.plannedStart,
  plannedEnd: s.plannedEnd,
  actualStart: s.actualStart,
  actualEnd: s.actualEnd,
  breakMinutes: s.breakMinutes,
  status: s.status,
  note: s.note,
  templateId: s.templateId,
  templateName: s.template?.name ?? null,
  color: s.template?.color ?? null,
  employee: s.employee
    ? {
        id: s.employee.id,
        name: `${s.employee.firstName} ${s.employee.lastName}`.trim(),
        department: s.employee.department,
        position: s.employee.position,
      }
    : undefined,
})

export type ShiftDto = ReturnType<typeof toShiftDto>

/**
 * Saat aralığı doğrulaması. Hata varsa mesaj (string), geçerliyse aralık döner.
 *
 * Gece vardiyasının bitişi 1440'ı AŞAR (22:00–02:00 → 1320–1560). Bu yüzden
 * "bitiş < başlangıç ise ertesi gündür" diye yorumlanmaz — o kural gerçek gece
 * vardiyasıyla yanlış girilmiş saati ayırt edilemez hale getirirdi; burada
 * doğrudan hatadır.
 */
export function validateRange(start: unknown, end: unknown): { start: number; end: number } | string {
  const s = Math.round(Number(start))
  const e = Math.round(Number(end))
  if (!Number.isFinite(s) || !Number.isFinite(e)) return "Başlangıç ve bitiş dakika olmalı"
  if (s < 0 || e > MAX_MINUTE) return "Saat aralığı gün sınırlarının dışında"
  if (e - s < MIN_SHIFT_MINUTES) return `Vardiya en az ${MIN_SHIFT_MINUTES} dakika olmalı`
  return { start: s, end: e }
}

/**
 * Fiilî damgaların doğrulaması.
 *
 * Plandan AYRI kurallar: fiilî uçlar tek tek konabilir (giriş damgalandı, çıkış
 * henüz yok) ve en kısa süre şartı yoktur — 5 dakika sonra çıkılmışsa kayıt odur.
 * Sadece sıra ve gün sınırı denetlenir.
 */
export function validateActual(
  start: unknown,
  end: unknown,
): { start: number | null; end: number | null } | string {
  const norm = (v: unknown) => {
    if (v == null || v === "") return null
    const n = Math.round(Number(v))
    return Number.isFinite(n) ? n : NaN
  }
  const s = norm(start)
  const e = norm(end)
  if (Number.isNaN(s) || Number.isNaN(e)) return "Fiilî saat dakika olmalı"
  if ((s != null && (s < 0 || s > MAX_MINUTE)) || (e != null && (e < 0 || e > MAX_MINUTE))) {
    return "Fiilî saat gün sınırlarının dışında"
  }
  // Gece vardiyasında çıkış 1440'ı aşar; "küçükse ertesi gün" tahmini burada da yok.
  if (s != null && e != null && e < s) return "Fiilî çıkış girişten önce olamaz"
  return { start: s, end: e }
}

/**
 * Vardiyanın durumu damgalardan TÜRETİLİR, istemciden alınmaz.
 *
 * Aksi halde "gelmedi" işaretli bir vardiyada giriş damgası da durabilir ve iki
 * ekran birbirini tutmaz. Tek istisna: devamsızlık açıkça işaretlenir.
 */
export function statusFor(
  actualStart: number | null,
  actualEnd: number | null,
  absent: boolean,
): "PLANNED" | "WORKED" | "ABSENT" {
  if (absent) return "ABSENT"
  return actualStart != null || actualEnd != null ? "WORKED" : "PLANNED"
}

/**
 * Aynı personele aynı gün çakışan vardiya var mı? Varsa hata mesajı.
 *
 * Çakışma UYARI değil, HATA: tek kişi aynı anda iki yerde olamaz ve üst üste
 * binen iki bar takvimde birbirini gizler — kullanıcı ikincisini hiç göremeden
 * "kaydettim" sanırdı.
 */
export async function findShiftConflict(
  companyId: string,
  employeeId: string,
  workDate: string,
  start: number,
  end: number,
  ignoreId?: string,
): Promise<string | null> {
  const sameDay = await prisma.workShift.findMany({
    where: {
      companyId,
      employeeId,
      workDate: dayToUtcDate(workDate),
      ...(ignoreId ? { id: { not: ignoreId } } : {}),
    },
    select: { plannedStart: true, plannedEnd: true },
  })
  const hit = sameDay.some((s) => overlaps(start, end, s.plannedStart, s.plannedEnd))
  return hit ? "Bu personelin aynı saatlerde başka vardiyası var" : null
}
