/**
 * Haftalık vardiya planının YAYINLANMASI ve personele gönderilmesi.
 *
 * Yayın, plan ile personel arasındaki tek köprü: bugüne kadar plan çizilir
 * çizilmez "canlı"ydı ama kimseye ulaşmıyordu. Yayın bir haftaya aittir, tek tek
 * vardiyalara değil (gerekçe şemada, `ShiftPublication`).
 *
 * E-POSTA GÖNDERİMİ YAYINI BLOKLAMAZ: Resend erişilemezse hafta yine yayınlanmış
 * sayılır ve kaç kişiye ulaşıldığı ayrıca döner. Aksi halde geçici bir sağlayıcı
 * hatası yöneticinin planı kesinleştirmesini engellerdi.
 */

import { prisma } from "@/lib/db/prisma"
import { sendEmailBatch } from "@/lib/email/resend"
import { shiftScheduleEmail } from "@/lib/email/templates"
import {
  dayToUtcDate,
  durationLabel,
  minuteToHHMM,
  netMinutes,
  shortDayLabel,
  utcDateToDay,
  weekDaysIso,
  weekRangeLabel,
} from "@/lib/personel/vardiya"

export type PublishResult = {
  publishedAt: string
  /** E-postası gönderilen personel sayısı. */
  notified: number
  /** Vardiyası olduğu halde e-posta adresi girilmemiş personel sayısı. */
  missingEmail: number
  /** Gönderim denendi ama başarısız olan personel sayısı. */
  failed: number
  shiftCount: number
}

/**
 * Haftayı yayınlar ve (istenirse) personele e-posta gönderir.
 *
 * Gönderim personel BAŞINA tek e-postadır ve yalnız kendi vardiyalarını içerir:
 * herkese tüm ekibin planını yollamak, maaş/pozisyon kadar hassas olmasa da
 * personelin izin ve devamsızlık bilgisini yan masaya açardı.
 */
export async function publishWeek(args: {
  companyId: string
  weekStart: string
  notify: boolean
  userId: string
}): Promise<PublishResult> {
  const { companyId, weekStart, notify, userId } = args
  const days = weekDaysIso(weekStart)

  const [company, shifts] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, branchName: true },
    }),
    prisma.workShift.findMany({
      where: {
        companyId,
        workDate: { gte: dayToUtcDate(days[0]), lte: dayToUtcDate(days[6]) },
      },
      select: {
        employeeId: true,
        workDate: true,
        plannedStart: true,
        plannedEnd: true,
        breakMinutes: true,
        status: true,
        employee: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: [{ workDate: "asc" }, { plannedStart: "asc" }],
    }),
  ])

  const publishedAt = new Date()
  const companyName = [company?.name, company?.branchName].filter(Boolean).join(" · ") || "İşletme"

  let notified = 0
  let missingEmail = 0
  let failed = 0

  if (notify) {
    // Personel bazında grupla: herkese YALNIZ kendi planı gider.
    const byEmployee = new Map<string, typeof shifts>()
    for (const s of shifts) {
      byEmployee.set(s.employeeId, [...(byEmployee.get(s.employeeId) ?? []), s])
    }

    // Mesajlar önce HAZIRLANIR, sonra tek çağrıda gider: alıcı başına ayrı istek
    // otuz kişilik bir ekipte sağlayıcı hız sınırına takılıyor ve isteği sunucu
    // zaman aşımına kadar uzatıyordu.
    const messages: { to: string; subject: string; html: string }[] = []

    for (const own of byEmployee.values()) {
      const employee = own[0].employee
      const name = `${employee.firstName} ${employee.lastName}`.trim()
      if (!employee.email) {
        missingEmail++
        continue
      }

      const rows = days.map((day) => {
        const dayShifts = own.filter((s) => utcDateToDay(s.workDate) === day)
        if (dayShifts.length === 0) {
          return { day: shortDayLabel(day), text: "İzin / boş", muted: true }
        }
        return {
          day: shortDayLabel(day),
          text: dayShifts
            .map((s) => `${minuteToHHMM(s.plannedStart)}–${minuteToHHMM(s.plannedEnd)}`)
            .join(", "),
        }
      })
      const total = own.reduce(
        (sum, s) => sum + netMinutes(s.plannedStart, s.plannedEnd, s.breakMinutes),
        0,
      )

      const { subject, html } = shiftScheduleEmail({
        employeeName: name,
        companyName,
        weekLabel: weekRangeLabel(weekStart),
        rows,
        totalLabel: durationLabel(total),
      })
      messages.push({ to: employee.email, subject, html })
    }

    const result = await sendEmailBatch(messages)
    notified = result.sent
    failed = result.failed
  }

  await prisma.shiftPublication.upsert({
    where: { companyId_weekStart: { companyId, weekStart: dayToUtcDate(weekStart) } },
    create: {
      companyId,
      weekStart: dayToUtcDate(weekStart),
      publishedAt,
      publishedBy: userId,
      notifiedCount: notified,
      shiftCount: shifts.length,
    },
    update: {
      publishedAt,
      publishedBy: userId,
      notifiedCount: notified,
      shiftCount: shifts.length,
    },
  })

  return {
    publishedAt: publishedAt.toISOString(),
    notified,
    missingEmail,
    failed,
    shiftCount: shifts.length,
  }
}
