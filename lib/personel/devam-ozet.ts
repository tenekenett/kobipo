/**
 * Aylık DEVAM özeti — personel başına tek satır (tek düze çalışan işletme).
 *
 * `lib/personel/puantaj.ts`nin vardiyasız karşılığıdır ve aynı sözleşmeyi izler:
 * uç YALNIZ OLGU döndürür (gün sayısı), para hesaplamaz. Günlük yevmiye böleni ve
 * "raporlu günü kes/kesme" kararı işletmeye göre değişir; sunucuda sabitlenirse
 * kullanıcı göremeden bordroya girer. Tutar, bordro aktarım penceresinde ve
 * görünür şekilde hesaplanır.
 *
 * Aynı hesabı iki tüketici okur (ekran + bordro aktarımı); ayrı sorgu yazılsaydı
 * takvimde görünen gün ile bordroya yazılan gün zamanla ayrışırdı.
 */

import { prisma } from "@/lib/db/prisma"
import {
  effectiveDayStatus,
  summarize,
  type DevamCell,
  type DevamLeave,
  type DevamOzet,
} from "@/lib/personel/devam"
import { normalizeOpeningHours } from "@/lib/personel/opening-hours"
import { toHolidayDto } from "@/lib/personel/tatil"
import { dayToUtcDate, utcDateToDay } from "@/lib/personel/vardiya"
import { flatEmployees, normalizeMode } from "@/lib/personel/kip"

export type DevamRow = DevamOzet & {
  employeeId: string
  name: string
  department: string | null
  position: string | null
  grossSalary: number | null
  /** Dönem içinde ayrılmış personel: satır bilgi amaçlı listelenir. */
  terminated: boolean
  terminationDate: string | null
  /** Personelin bu ayda şirkette olduğu gün sayısı (istihdam dışı günler hariç). */
  employedDays: number
  payroll: { id: string; status: string; bonus: number; otherDeduction: number } | null
}

export type DevamOzetResult = {
  year: number
  month: number
  from: string
  to: string
  /** Ayın günleri ("YYYY-MM-DD") — ekran ızgarayı bundan çizer. */
  days: string[]
  rows: DevamRow[]
}

/** Ayın gün listesi. */
export function monthDays(year: number, month: number): string[] {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return Array.from(
    { length: last },
    (_, i) =>
      `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`,
  )
}

export async function computeDevamOzet(args: {
  companyId: string
  year: number
  month: number
}): Promise<DevamOzetResult> {
  const { companyId, year, month } = args
  const days = monthDays(year, month)
  const first = days[0]
  const last = days[days.length - 1]
  const from = dayToUtcDate(first)
  const to = dayToUtcDate(last)

  const [employees, records, leaves, holidays, company, payrolls] = await Promise.all([
    prisma.employee.findMany({
      /**
       * Puantajla aynı kapsam: aktifler + dönem içinde ayrılanlar + dönemde
       * devam kaydı bulunanlar. Üçüncüsü, ayrılış tarihi girilmeden pasife
       * çekilmiş kayıtları da yakalar.
       */
      where: {
        companyId,
        OR: [
          { status: "ACTIVE" },
          { terminationDate: { gte: from, lte: to } },
          { attendance: { some: { workDate: { gte: from, lte: to } } } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        department: true,
        position: true,
        grossSalary: true,
        status: true,
        hireDate: true,
        terminationDate: true,
        usesShifts: true,
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
    prisma.attendanceDay.findMany({
      where: { companyId, workDate: { gte: from, lte: to } },
      select: { employeeId: true, workDate: true, status: true, note: true },
    }),
    // Aya DEĞEN onaylı izinler; aydan önce başlayıp içine sarkanlar dahil.
    prisma.leaveRecord.findMany({
      where: { companyId, status: "APPROVED", startDate: { lte: to }, endDate: { gte: from } },
      select: { employeeId: true, type: true, startDate: true, endDate: true },
    }),
    prisma.companyHoliday.findMany({ where: { companyId } }),
    prisma.company.findUnique({
      where: { id: companyId },
      // `workScheduleMode`: karma işletmede bu özet YALNIZ sabit mesaili personeli
      // sayar; vardiyalılar puantaja gider (lib/personel/puantaj.ts). Aynı çalışan
      // iki özette birden görünseydi bordroya hem saat hem gün girerdi.
      select: { openingHours: true, workScheduleMode: true },
    }),
    prisma.payrollRecord.findMany({
      where: { companyId, periodYear: year, periodMonth: month },
      select: { id: true, employeeId: true, status: true, bonus: true, otherDeduction: true },
    }),
  ])

  const openingHours = normalizeOpeningHours(company?.openingHours)
  const holidayDtos = holidays.map(toHolidayDto)
  const leaveDtos: DevamLeave[] = leaves.map((l) => ({
    employeeId: l.employeeId,
    type: l.type,
    startDay: utcDateToDay(l.startDate),
    endDay: utcDateToDay(l.endDate),
  }))
  const recordKey = (employeeId: string, day: string) => `${employeeId}|${day}`
  const recordMap = new Map(
    records.map((r) => [recordKey(r.employeeId, utcDateToDay(r.workDate)), r]),
  )
  const payrollByEmployee = new Map(payrolls.map((p) => [p.employeeId, p]))

  const rows: DevamRow[] = flatEmployees(
    employees,
    normalizeMode(company?.workScheduleMode),
  ).map((e) => {
    const employee = {
      id: e.id,
      hireDay: e.hireDate ? utcDateToDay(e.hireDate) : null,
      terminationDay: e.terminationDate ? utcDateToDay(e.terminationDate) : null,
    }
    const cells: DevamCell[] = days.map((day) =>
      effectiveDayStatus({
        day,
        employee,
        record: recordMap.get(recordKey(e.id, day)) ?? null,
        leaves: leaveDtos,
        holidays: holidayDtos,
        openingHours,
      }),
    )
    const payroll = payrollByEmployee.get(e.id)
    return {
      employeeId: e.id,
      name: `${e.firstName} ${e.lastName}`.trim(),
      department: e.department,
      position: e.position,
      grossSalary: e.grossSalary != null ? Number(e.grossSalary) : null,
      terminated: e.status === "TERMINATED" || e.terminationDate != null,
      terminationDate: e.terminationDate ? utcDateToDay(e.terminationDate) : null,
      employedDays: cells.filter((c) => c.status != null).length,
      ...summarize(cells),
      payroll: payroll
        ? {
            id: payroll.id,
            status: payroll.status,
            bonus: Number(payroll.bonus),
            otherDeduction: Number(payroll.otherDeduction),
          }
        : null,
    }
  })

  return { year, month, from: first, to: last, days, rows }
}
