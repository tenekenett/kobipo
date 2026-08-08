/**
 * Haftalık vardiya çizelgesi — personel × gün tablosu.
 *
 * Route'ta değil burada, çünkü aynı tabloyu İKİ tüketici okuyor: dışa aktarma
 * dataset'i (Excel/PDF) ve yazdırma görünümü. Export kendi sorgusunu yazsaydı
 * ekranda görünen çizelgeyle indirilen dosya zamanla ayrışırdı — bu projede
 * dışa aktarma katmanının kuralı zaten "kendi sorgunu yazma, paylaşılan sorguyu
 * çağır"dır (bkz. lib/export/datasets/*, lib/personel/puantaj.ts).
 *
 * Çıktı MUTFAK DUVARINA asılacak çizelgedir: satır personel, sütun gün, hücre
 * saat aralığı. Puantajın aksine burada toplam değil KAPSAMA okunur — kimin
 * hangi gün boş olduğu bir bakışta görünmeli.
 */

import { prisma } from "@/lib/db/prisma"
import {
  dayToUtcDate,
  durationLabel,
  minuteToHHMM,
  netMinutes,
  utcDateToDay,
  weekDaysIso,
} from "@/lib/personel/vardiya"
import { holidayMap, toHolidayDto } from "@/lib/personel/tatil"

export type PlanCell = {
  /** "09:00–17:00" — aynı güne iki vardiya varsa virgülle. Boşsa "". */
  text: string
  /** İzin etiketi (varsa) — hücre saat yerine bunu gösterir. */
  leave: string | null
  minutes: number
}

export type PlanRow = {
  employeeId: string
  name: string
  position: string | null
  department: string | null
  cells: PlanCell[]
  totalMinutes: number
}

export type WeekPlan = {
  weekStart: string
  days: string[]
  /** Gün başına tatil adı; yoksa null. */
  holidays: (string | null)[]
  rows: PlanRow[]
  /** Gün başına o gün çalışan kişi sayısı — çizelgenin altındaki kapsama satırı. */
  coverage: number[]
  totalMinutes: number
}

const LEAVE_LABELS: Record<string, string> = {
  ANNUAL: "Yıllık izin",
  EXCUSE: "Mazeret",
  SICK: "Rapor",
  UNPAID: "Ücretsiz izin",
}

export async function computeWeekPlan(args: {
  companyId: string
  weekStart: string
}): Promise<WeekPlan> {
  const { companyId, weekStart } = args
  const days = weekDaysIso(weekStart)
  const from = dayToUtcDate(days[0])
  const to = dayToUtcDate(days[6])

  const [shifts, leaves, holidayRows] = await Promise.all([
    prisma.workShift.findMany({
      where: { companyId, workDate: { gte: from, lte: to } },
      select: {
        employeeId: true,
        workDate: true,
        plannedStart: true,
        plannedEnd: true,
        breakMinutes: true,
        status: true,
        employee: {
          select: { id: true, firstName: true, lastName: true, position: true, department: true },
        },
      },
      orderBy: [{ workDate: "asc" }, { plannedStart: "asc" }],
    }),
    prisma.leaveRecord.findMany({
      where: { companyId, status: "APPROVED", startDate: { lte: to }, endDate: { gte: from } },
      select: { employeeId: true, type: true, startDate: true, endDate: true },
    }),
    prisma.companyHoliday.findMany({
      where: { companyId },
      select: { id: true, name: true, date: true, recurring: true, halfDayFrom: true },
    }),
  ])

  const holidays = holidayMap(holidayRows.map(toHolidayDto), days)

  /**
   * Satırlar VARDİYASI OLAN personelden kurulur.
   *
   * Bütün aktif personeli listelemek, çizelgeyi o hafta hiç çalışmayan (izinli,
   * yeni ayrılmış, yarı zamanlı) isimlerle şişiriyor ve duvara asılan kâğıdı
   * okunmaz hale getiriyordu. İzinli personel yine görünür — çünkü izin de o
   * haftaya ait bir bilgi ve satırı izin hücresiyle açılır.
   */
  const byEmployee = new Map<string, PlanRow>()
  const ensureRow = (
    id: string,
    info: { firstName: string; lastName: string; position: string | null; department: string | null },
  ) => {
    const existing = byEmployee.get(id)
    if (existing) return existing
    const row: PlanRow = {
      employeeId: id,
      name: `${info.firstName} ${info.lastName}`.trim(),
      position: info.position,
      department: info.department,
      cells: days.map(() => ({ text: "", leave: null, minutes: 0 })),
      totalMinutes: 0,
    }
    byEmployee.set(id, row)
    return row
  }

  for (const s of shifts) {
    const row = ensureRow(s.employeeId, s.employee)
    const index = days.indexOf(utcDateToDay(s.workDate))
    if (index < 0) continue
    const cell = row.cells[index]
    const label = `${minuteToHHMM(s.plannedStart)}–${minuteToHHMM(s.plannedEnd)}`
    // Devamsızlık çizelgede işaretlenir: geçmiş bir haftayı yazdıran kişi neyin
    // planlandığını değil ne olduğunu görmek ister.
    cell.text = [cell.text, s.status === "ABSENT" ? `${label} (gelmedi)` : label]
      .filter(Boolean)
      .join(", ")
    if (s.status !== "ABSENT") {
      const minutes = netMinutes(s.plannedStart, s.plannedEnd, s.breakMinutes)
      cell.minutes += minutes
      row.totalMinutes += minutes
    }
  }

  // İzinler vardiyasız günlere yazılır; vardiyası olan günü EZMEZ (izinli
  // personel çağrılmış olabilir, bu bilgi saatten daha az önemli değil).
  if (leaves.length > 0) {
    const employees = await prisma.employee.findMany({
      where: { id: { in: [...new Set(leaves.map((l) => l.employeeId))] } },
      select: { id: true, firstName: true, lastName: true, position: true, department: true },
    })
    const info = new Map(employees.map((e) => [e.id, e]))
    for (const l of leaves) {
      const person = info.get(l.employeeId)
      if (!person) continue
      const row = ensureRow(l.employeeId, person)
      const start = utcDateToDay(l.startDate)
      const end = utcDateToDay(l.endDate)
      days.forEach((day, i) => {
        if (day < start || day > end) return
        row.cells[i].leave = LEAVE_LABELS[l.type] ?? "İzin"
      })
    }
  }

  const rows = [...byEmployee.values()].sort((a, b) => a.name.localeCompare(b.name, "tr"))
  const coverage = days.map(
    (_, i) => rows.filter((r) => r.cells[i].minutes > 0).length,
  )

  return {
    weekStart,
    days,
    holidays: days.map((d) => holidays.get(d)?.name ?? null),
    rows,
    coverage,
    totalMinutes: rows.reduce((sum, r) => sum + r.totalMinutes, 0),
  }
}

/** Çizelge altındaki "haftalık toplam" metni — ekran ve dosya aynı biçimi kullanır. */
export const planTotalLabel = (minutes: number) => durationLabel(minutes)
