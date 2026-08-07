/**
 * Aylık puantaj özeti — personel başına tek satır.
 *
 * Route'ta değil burada, çünkü aynı hesabı İKİ tüketici okuyor: `/api/personel/
 * shifts/ozet` (ekran) ve dışa aktarma dataset'i. Export kendi sorgusunu yazsaydı
 * ekranda görünen rakamla indirilen dosyadaki rakam zamanla ayrışırdı — bu
 * projede dışa aktarma katmanının kuralı zaten "kendi sorgunu yazma, paylaşılan
 * sorguyu çağır"dır (bkz. lib/export/datasets/*).
 *
 * Uç YALNIZ OLGU döndürür (dakika, gün, adet) ve maliyet dışında para
 * hesaplamaz: fazla mesai çarpanı ve günlük yevmiye böleni işletmeye göre
 * değişen, mevzuata bağlı seçimlerdir; sunucuda sabitlenirse kullanıcı göremeden
 * bordroya girer. Öneri tutarı bordro aktarım penceresinde, çarpanı görünür
 * şekilde hesaplanır. İşçilik maliyeti bunun istisnasıdır ve kendi böleni
 * ekranda yazılı olarak sunulur (lib/personel/maliyet.ts).
 */

import { prisma } from "@/lib/db/prisma"
import {
  actualNetMinutes,
  dayToUtcDate,
  earlyLeaveMinutes,
  lateMinutes,
  netMinutes,
  overtimeMinutes,
  utcDateToDay,
} from "@/lib/personel/vardiya"
import { laborCost } from "@/lib/personel/maliyet"

export type PuantajRow = {
  employeeId: string
  name: string
  department: string | null
  position: string | null
  grossSalary: number | null
  /** Dönem içinde işten ayrılmış personel: satır bilgi amaçlı listelenir. */
  terminated: boolean
  terminationDate: string | null
  shiftCount: number
  plannedMinutes: number
  actualMinutes: number
  stampedCount: number
  lateCount: number
  lateMinutes: number
  earlyLeaveMinutes: number
  overtimeMinutes: number
  absentCount: number
  leaveDays: number
  /** Brüt işçilik; maaşı girilmemiş personelde null ("bilinmiyor" ≠ "sıfır"). */
  plannedCost: number | null
  actualCost: number | null
  payroll: { id: string; status: string; bonus: number; otherDeduction: number } | null
}

export type PuantajResult = {
  year: number
  month: number
  from: string
  to: string
  rows: PuantajRow[]
  /**
   * Dönemin net satış cirosu — işçilik/ciro oranı için. Tanımı kâr-zarar
   * raporundakiyle AYNI (satış faturalarının net tutarı, iptal/dönüştürülmüş
   * hariç); farklı bir tanım kullansaydı iki ekran aynı ay için iki ciro gösterirdi.
   */
  revenue: number
}

export async function computePuantaj(args: {
  companyId: string
  year: number
  month: number
}): Promise<PuantajResult> {
  const { companyId, year, month } = args

  const first = `${year}-${String(month).padStart(2, "0")}-01`
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const last = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
  const from = dayToUtcDate(first)
  const to = dayToUtcDate(last)

  const [employees, shifts, leaves, payrolls, sales] = await Promise.all([
    prisma.employee.findMany({
      /**
       * Sadece AKTİF personel YETMEZ: ayın 20'sinde çıkan kişinin o aya ait
       * çalışması da bordrolanacaktır. Aktiflerin yanına dönem içinde ayrılanlar
       * ve dönemde vardiyası bulunan herkes eklenir — ikinci koşul, ayrılış
       * tarihi girilmeden pasife çekilmiş kayıtları da yakalar.
       */
      where: {
        companyId,
        OR: [
          { status: "ACTIVE" },
          { terminationDate: { gte: from, lte: to } },
          { shifts: { some: { workDate: { gte: from, lte: to } } } },
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
        terminationDate: true,
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    }),
    prisma.workShift.findMany({
      where: { companyId, workDate: { gte: from, lte: to } },
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
    // Aya DEĞEN izinler; aydan önce başlayıp içine sarkanlar dahil, tamamen
    // geçmişte kalanlar hariç.
    prisma.leaveRecord.findMany({
      where: { companyId, status: "APPROVED", startDate: { lte: to }, endDate: { gte: from } },
      select: { employeeId: true, startDate: true, endDate: true },
    }),
    // Bu dönemde bordro açılmış mı: aktarım penceresi yeni kayıt mı açacağını
    // yoksa mevcudu mu güncelleyeceğini buradan bilir.
    prisma.payrollRecord.findMany({
      where: { companyId, periodYear: year, periodMonth: month },
      select: { id: true, employeeId: true, status: true, bonus: true, otherDeduction: true },
    }),
    prisma.invoice.aggregate({
      where: {
        companyId,
        type: "SALES",
        status: { notIn: ["CANCELLED", "CONVERTED"] },
        date: { gte: from, lte: to },
      },
      _sum: { netAmount: true },
    }),
  ])

  const payrollByEmployee = new Map(payrolls.map((p) => [p.employeeId, p]))

  const rows: PuantajRow[] = employees.map((e) => {
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

    const gross = e.grossSalary != null ? Number(e.grossSalary) : null
    const payroll = payrollByEmployee.get(e.id)
    return {
      employeeId: e.id,
      name: `${e.firstName} ${e.lastName}`.trim(),
      department: e.department,
      position: e.position,
      grossSalary: gross,
      terminated: e.status === "TERMINATED" || e.terminationDate != null,
      terminationDate: e.terminationDate ? utcDateToDay(e.terminationDate) : null,
      ...acc,
      leaveDays: countLeaveDays(leaves, e.id, from, to),
      plannedCost: laborCost(acc.plannedMinutes, gross),
      // Fiilî maliyet yalnız damga varsa anlamlı: damgasız ayda 0 TL göstermek
      // "bedava çalışıldı" gibi okunurdu.
      actualCost: acc.stampedCount > 0 ? laborCost(acc.actualMinutes, gross) : null,
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

  return { year, month, from: first, to: last, rows, revenue: Number(sales._sum.netAmount || 0) }
}

const DAY_MS = 24 * 60 * 60 * 1000

/** İzin kaydının AY İÇİNE düşen gün sayısı — aya taşan izinler kırpılır. */
function countLeaveDays(
  leaves: { employeeId: string; startDate: Date; endDate: Date }[],
  employeeId: string,
  from: Date,
  to: Date,
): number {
  let days = 0
  for (const l of leaves) {
    if (l.employeeId !== employeeId) continue
    const s = Math.max(
      from.getTime(),
      Date.UTC(l.startDate.getUTCFullYear(), l.startDate.getUTCMonth(), l.startDate.getUTCDate()),
    )
    const e = Math.min(
      to.getTime(),
      Date.UTC(l.endDate.getUTCFullYear(), l.endDate.getUTCMonth(), l.endDate.getUTCDate()),
    )
    if (e >= s) days += Math.round((e - s) / DAY_MS) + 1
  }
  return days
}
