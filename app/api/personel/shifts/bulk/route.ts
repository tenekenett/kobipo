import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { dayToUtcDate, overlaps, shiftDayIso, utcDateToDay } from "@/lib/personel/vardiya"
import { holidayOn, toHolidayDto } from "@/lib/personel/tatil"
import { DAY_RE, validateRange } from "@/lib/personel/shift-api"

export const dynamic = "force-dynamic"

/** Tek istekte açılabilecek en çok vardiya — 30 personel × 31 gün civarı. */
const MAX_CREATE = 1000

type Planned = {
  employeeId: string
  day: string
  start: number
  end: number
  breakMinutes: number
  /** Kopyalamada kaynağınki taşınır: şablon bağı düşerse bar adını ve rengini kaybeder. */
  templateId: string | null
}

/**
 * Toplu vardiya açma.
 *
 * İki kip:
 * - `template`: seçilen personellere seçilen günlerde aynı saat aralığını yazar.
 * - `copy`: bir günün/haftanın vardiyalarını başka bir güne/haftaya kopyalar.
 *
 * ÇAKIŞMA = ATLA, hata değil. Tekil uçta çakışma 409'dur (kullanıcı tek bir bar
 * çiziyordur, sessizce yutulmamalı); toplu doldurmada ise amaç "boş yerleri
 * doldur"dur — zaten vardiyası olan bir güne takıldı diye 200 kaydın hepsini
 * iptal etmek işi kullanılamaz hale getirir. Atlananların sayısı yanıtta döner.
 *
 * İZİN ve TATİL de aynı şekilde ATLANIR — burada `force` yolu YOKTUR. Tekil uçta
 * "izinli, yine de aç?" diye sormak anlamlıdır (kullanıcı tek bir kişiye bakıyor);
 * 200 kaydı kapsayan bir doldurmada aynı soru cevaplanamaz, sessizce izin gününe
 * vardiya yazmak ise bu ekranın düzeltmeye çalıştığı hatanın ta kendisidir.
 * İstisna gerekiyorsa o vardiya takvimden tek tek açılır.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const companyId = await resolveCompanyId(body.companyId)
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyWrite(companyId)

  const mode = body.mode === "copy" ? "copy" : "template"
  const planned = mode === "copy" ? await planCopy(companyId, body) : await planTemplate(companyId, body)
  if (typeof planned === "string") return NextResponse.json({ error: planned }, { status: 400 })
  if (planned.length === 0) {
    return NextResponse.json({ created: 0, skipped: 0, message: "Uygulanacak vardiya bulunamadı" })
  }
  if (planned.length > MAX_CREATE) {
    return NextResponse.json(
      { error: `Tek seferde en çok ${MAX_CREATE} vardiya açılabilir (${planned.length} istendi)` },
      { status: 400 },
    )
  }

  // Hedef aralıktaki mevcut vardiyalar, izinler ve tatiller TEK sorguda çekilir:
  // kayıt başına ayrı sorgu 200 kayıtta 200 gidiş-dönüş demekti.
  const days = [...new Set(planned.map((p) => p.day))].sort()
  const employeeIds = [...new Set(planned.map((p) => p.employeeId))]
  const rangeStart = dayToUtcDate(days[0])
  const rangeEnd = dayToUtcDate(days[days.length - 1])

  const [existing, leaves, holidayRows] = await Promise.all([
    prisma.workShift.findMany({
      where: {
        companyId,
        employeeId: { in: employeeIds },
        workDate: { gte: rangeStart, lte: rangeEnd },
      },
      select: { employeeId: true, workDate: true, plannedStart: true, plannedEnd: true },
    }),
    // Aralığa DEĞEN izinler: aralıktan önce başlayıp içine sarkanlar da dahil.
    prisma.leaveRecord.findMany({
      where: {
        companyId,
        employeeId: { in: employeeIds },
        status: "APPROVED",
        startDate: { lte: rangeEnd },
        endDate: { gte: rangeStart },
      },
      select: { employeeId: true, startDate: true, endDate: true },
    }),
    prisma.companyHoliday.findMany({
      where: { companyId },
      select: { id: true, name: true, date: true, recurring: true, halfDayFrom: true },
    }),
  ])

  const onLeave = new Set<string>()
  for (const l of leaves) {
    for (const day of days) {
      const d = dayToUtcDate(day)
      if (l.startDate <= d && d <= l.endDate) onLeave.add(`${l.employeeId}|${day}`)
    }
  }

  const holidays = holidayRows.map(toHolidayDto)
  const holidayByDay = new Map(days.map((day) => [day, holidayOn(holidays, day)]))

  // Aynı istek içindeki kayıtlar da birbiriyle çakışabilir (iki şablon aynı güne):
  // kabul edilenler listeye eklenerek sonraki adayların kontrolüne dahil edilir.
  const busy = new Map<string, { start: number; end: number }[]>()
  const keyOf = (employeeId: string, day: string) => `${employeeId}|${day}`
  for (const e of existing) {
    const k = keyOf(e.employeeId, utcDateToDay(e.workDate))
    busy.set(k, [...(busy.get(k) ?? []), { start: e.plannedStart, end: e.plannedEnd }])
  }

  const accepted: Planned[] = []
  let skipped = 0
  let skippedLeave = 0
  let skippedHoliday = 0
  for (const p of planned) {
    const k = keyOf(p.employeeId, p.day)
    const list = busy.get(k) ?? []
    if (list.some((b) => overlaps(p.start, p.end, b.start, b.end))) {
      skipped++
      continue
    }
    if (onLeave.has(k)) {
      skippedLeave++
      continue
    }
    // Yarım gün tatilde yalnız tatile taşan vardiya atlanır; arifenin sabahı
    // normal iş günüdür.
    const holiday = holidayByDay.get(p.day)
    if (holiday && (holiday.halfDayFrom == null || p.end > holiday.halfDayFrom)) {
      skippedHoliday++
      continue
    }
    busy.set(k, [...list, { start: p.start, end: p.end }])
    accepted.push(p)
  }

  if (accepted.length > 0) {
    await prisma.workShift.createMany({
      data: accepted.map((p) => ({
        companyId,
        employeeId: p.employeeId,
        workDate: dayToUtcDate(p.day),
        plannedStart: p.start,
        plannedEnd: p.end,
        breakMinutes: p.breakMinutes,
        templateId: p.templateId,
        createdBy: user.id,
      })),
    })
  }

  return NextResponse.json({ created: accepted.length, skipped, skippedLeave, skippedHoliday })
}

/** `template` kipi: personel × gün kartezyeni. */
async function planTemplate(companyId: string, body: any): Promise<Planned[] | string> {
  const employeeIds: string[] = Array.isArray(body.employeeIds) ? body.employeeIds : []
  const days: string[] = Array.isArray(body.days) ? body.days : []
  if (employeeIds.length === 0) return "En az bir personel seçin"
  if (days.length === 0 || !days.every((d) => DAY_RE.test(d))) return "Geçerli gün seçilmedi"

  let start = body.startMinute
  let end = body.endMinute
  let breakMinutes = Number(body.breakMinutes) || 0

  // Şablon verildiyse saatler ONDAN okunur: istemcinin gönderdiği saat şablonla
  // uyuşmazsa bar "Sabah" adını taşıyıp başka saatte durur.
  if (body.templateId) {
    const t = await prisma.shiftTemplate.findFirst({ where: { id: body.templateId, companyId } })
    if (!t) return "Şablon bulunamadı"
    start = t.startMinute
    end = t.endMinute
    breakMinutes = t.breakMinutes
  }

  const range = validateRange(start, end)
  if (typeof range === "string") return range

  const valid = await validEmployeeIds(companyId, employeeIds)
  if (valid.length === 0) return "Personel bulunamadı"

  return valid.flatMap((employeeId) =>
    days.map((day) => ({
      employeeId,
      day,
      start: range.start,
      end: range.end,
      breakMinutes: Math.max(0, Math.round(breakMinutes)),
      templateId: body.templateId || null,
    })),
  )
}

/** `copy` kipi: kaynak gün(ler)deki vardiyaları hedefe aynı saatlerle taşır. */
async function planCopy(companyId: string, body: any): Promise<Planned[] | string> {
  const fromDay: string = body.fromDay
  const toDay: string = body.toDay
  const dayCount = Math.max(1, Math.min(31, Math.round(Number(body.dayCount) || 1)))
  if (!DAY_RE.test(String(fromDay)) || !DAY_RE.test(String(toDay))) {
    return "fromDay/toDay YYYY-MM-DD olmalı"
  }

  const source = await prisma.workShift.findMany({
    where: {
      companyId,
      workDate: {
        gte: dayToUtcDate(fromDay),
        lte: dayToUtcDate(shiftDayIso(fromDay, dayCount - 1)),
      },
    },
    select: {
      employeeId: true,
      workDate: true,
      plannedStart: true,
      plannedEnd: true,
      breakMinutes: true,
      templateId: true,
    },
  })

  // Kaynaktaki gün farkı hedefte birebir korunur: haftanın 3. günündeki vardiya
  // hedef haftanın da 3. gününe düşsün.
  return source.map((s) => {
    const offset = daysBetween(fromDay, utcDateToDay(s.workDate))
    return {
      employeeId: s.employeeId,
      day: shiftDayIso(toDay, offset),
      start: s.plannedStart,
      end: s.plannedEnd,
      breakMinutes: s.breakMinutes,
      templateId: s.templateId,
    }
  })
}

const DAY_MS = 24 * 60 * 60 * 1000
const daysBetween = (a: string, b: string) =>
  Math.round((dayToUtcDate(b).getTime() - dayToUtcDate(a).getTime()) / DAY_MS)

/** İstemciden gelen personel id'lerinin bu firmaya ait olanları. */
async function validEmployeeIds(companyId: string, ids: string[]) {
  const rows = await prisma.employee.findMany({
    where: { companyId, id: { in: ids } },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}
