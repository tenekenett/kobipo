import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { dayToUtcDate } from "@/lib/personel/vardiya"
import {
  DAY_RE,
  SHIFT_INCLUDE,
  findShiftConflict,
  toShiftDto,
  validateRange,
} from "@/lib/personel/shift-api"

export const dynamic = "force-dynamic"

/**
 * Vardiya planı listesi + oluşturma.
 *
 * Saatler gün başından itibaren DAKİKA (bkz. lib/personel/vardiya.ts); `workDate`
 * saatsiz gündür ve UTC gece yarısı olarak yazılır — yerel çevrimle yazılsaydı
 * TSİ'de gün kayardı.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const companyId = await resolveCompanyId(searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  const from = searchParams.get("from")
  const to = searchParams.get("to") || from
  if (!from || !DAY_RE.test(from) || !to || !DAY_RE.test(to)) {
    return NextResponse.json({ error: "from/to YYYY-MM-DD olmalı" }, { status: 400 })
  }

  await ensureCompanyAccess(companyId)

  // Tek personel süzgeci: personel kartının Vardiya sekmesi bütün firmayı çekip
  // istemcide ayıklamasın diye.
  const employeeId = searchParams.get("employeeId")

  const shifts = await prisma.workShift.findMany({
    where: {
      companyId,
      ...(employeeId ? { employeeId } : {}),
      workDate: { gte: dayToUtcDate(from), lte: dayToUtcDate(to) },
    },
    include: SHIFT_INCLUDE,
    orderBy: [{ workDate: "asc" }, { plannedStart: "asc" }],
  })

  return NextResponse.json(shifts.map(toShiftDto))
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const companyId = await resolveCompanyId(body.companyId)
  const { employeeId, workDate } = body
  if (!companyId || !employeeId || !workDate) {
    return NextResponse.json({ error: "companyId, employeeId, workDate zorunlu" }, { status: 400 })
  }
  if (!DAY_RE.test(String(workDate))) {
    return NextResponse.json({ error: "workDate YYYY-MM-DD olmalı" }, { status: 400 })
  }

  const range = validateRange(body.plannedStart, body.plannedEnd)
  if (typeof range === "string") return NextResponse.json({ error: range }, { status: 400 })

  await ensureCompanyWrite(companyId)

  // Personel bu firmaya mı ait: companyId istemciden geliyor, doğrulanmazsa
  // başka firmanın personeline vardiya açılabilirdi.
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId } })
  if (!employee) return NextResponse.json({ error: "Personel bulunamadı" }, { status: 404 })

  const conflict = await findShiftConflict(companyId, employeeId, workDate, range.start, range.end)
  if (conflict) return NextResponse.json({ error: conflict }, { status: 409 })

  const created = await prisma.workShift.create({
    data: {
      companyId,
      employeeId,
      workDate: dayToUtcDate(workDate),
      plannedStart: range.start,
      plannedEnd: range.end,
      breakMinutes: Math.max(0, Math.round(Number(body.breakMinutes) || 0)),
      note: body.note || null,
      templateId: body.templateId || null,
      createdBy: user.id,
    },
    include: SHIFT_INCLUDE,
  })

  return NextResponse.json(toShiftDto(created), { status: 201 })
}
