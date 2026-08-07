import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import {
  actualNetMinutes,
  dayToUtcDate,
  earlyLeaveMinutes,
  lateMinutes,
  netMinutes,
  overtimeMinutes,
} from "@/lib/personel/vardiya"

export const dynamic = "force-dynamic"

/**
 * Aylık puantaj özeti — personel başına tek satır.
 *
 * Uç YALNIZ OLGU döndürür (dakika, gün, adet); para tutarı hesaplamaz. Fazla
 * mesai ücreti çarpanı ve günlük yevmiye bölen'i işletmeye göre değişen, üstelik
 * mevzuata bağlı seçimlerdir; sunucuda sabitlenirse kullanıcı göremeden bordroya
 * girer. Öneri tutarı bordro aktarım penceresinde, çarpanı görünür şekilde hesaplanır.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const companyId = await resolveCompanyId(searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  const year = Number(searchParams.get("year"))
  const month = Number(searchParams.get("month"))
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "year/month geçersiz" }, { status: 400 })
  }

  await ensureCompanyAccess(companyId)

  const first = `${year}-${String(month).padStart(2, "0")}-01`
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const last = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`

  const [employees, shifts, leaves, payrolls] = await Promise.all([
    prisma.employee.findMany({
      where: { companyId, status: "ACTIVE" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        department: true,
        position: true,
        grossSalary: true,
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
    prisma.workShift.findMany({
      where: { companyId, workDate: { gte: dayToUtcDate(first), lte: dayToUtcDate(last) } },
      select: {
        employeeId: true,
        plannedStart: true,
        plannedEnd: true,
        actualStart: true,
        actualEnd: true,
        breakMinutes: true,
        status: true,
      },
    }),
    prisma.leaveRecord.findMany({
      where: { companyId, status: "APPROVED", startDate: { lte: dayToUtcDate(last) } },
      select: { employeeId: true, startDate: true, endDate: true },
    }),
    // Bu dönemde bordro açılmış mı: aktarım penceresi yeni kayıt mı açacağını
    // yoksa mevcudu mu güncelleyeceğini buradan bilir.
    prisma.payrollRecord.findMany({
      where: { companyId, periodYear: year, periodMonth: month },
      select: { id: true, employeeId: true, status: true, bonus: true, otherDeduction: true },
    }),
  ])

  const payrollByEmployee = new Map(payrolls.map((p) => [p.employeeId, p]))

  const rows = employees.map((e) => {
    const own = shifts.filter((s) => s.employeeId === e.id)
    const acc = {
      shiftCount: own.length,
      plannedMinutes: 0,
      actualMinutes: 0,
      stampedCount: 0,
      lateCount: 0,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      overtimeMinutes: 0,
      absentCount: 0,
    }
    for (const s of own) {
      if (s.status === "ABSENT") {
        acc.absentCount++
        // Devamsız günün planı da toplama girer: "planlanan" ne kadar iş yükü
        // ayrıldığını söyler, gelinip gelinmediğini değil.
        acc.plannedMinutes += netMinutes(s.plannedStart, s.plannedEnd, s.breakMinutes)
        continue
      }
      acc.plannedMinutes += netMinutes(s.plannedStart, s.plannedEnd, s.breakMinutes)
      const worked = actualNetMinutes(s)
      if (worked != null) {
        acc.actualMinutes += worked
        acc.stampedCount++
      }
      const late = lateMinutes(s)
      if (late) {
        acc.lateCount++
        acc.lateMinutes += late
      }
      acc.earlyLeaveMinutes += earlyLeaveMinutes(s) ?? 0
      acc.overtimeMinutes += overtimeMinutes(s) ?? 0
    }

    const payroll = payrollByEmployee.get(e.id)
    return {
      employeeId: e.id,
      name: `${e.firstName} ${e.lastName}`.trim(),
      department: e.department,
      position: e.position,
      grossSalary: e.grossSalary != null ? Number(e.grossSalary) : null,
      ...acc,
      leaveDays: countLeaveDays(leaves, e.id, first, last),
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

  return NextResponse.json({ year, month, from: first, to: last, rows })
}

const DAY_MS = 24 * 60 * 60 * 1000

/** İzin kaydının AY İÇİNE düşen gün sayısı — aya taşan izinler kırpılır. */
function countLeaveDays(
  leaves: { employeeId: string; startDate: Date; endDate: Date }[],
  employeeId: string,
  first: string,
  last: string,
): number {
  const from = dayToUtcDate(first).getTime()
  const to = dayToUtcDate(last).getTime()
  let days = 0
  for (const l of leaves) {
    if (l.employeeId !== employeeId) continue
    const s = Math.max(from, Date.UTC(l.startDate.getUTCFullYear(), l.startDate.getUTCMonth(), l.startDate.getUTCDate()))
    const e = Math.min(to, Date.UTC(l.endDate.getUTCFullYear(), l.endDate.getUTCMonth(), l.endDate.getUTCDate()))
    if (e >= s) days += Math.round((e - s) / DAY_MS) + 1
  }
  return days
}
