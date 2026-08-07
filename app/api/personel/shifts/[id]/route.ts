import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { utcDateToDay } from "@/lib/personel/vardiya"
import {
  SHIFT_INCLUDE,
  findShiftBlock,
  statusFor,
  toShiftDto,
  validateActual,
  validateRange,
} from "@/lib/personel/shift-api"

export const dynamic = "force-dynamic"

/** Tekil vardiya: saat güncelleme (sürükleme buraya düşer) ve silme. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  const companyId = await resolveCompanyId(body.companyId)
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyWrite(companyId)

  const existing = await prisma.workShift.findFirst({ where: { id, companyId } })
  if (!existing) return NextResponse.json({ error: "Vardiya bulunamadı" }, { status: 404 })

  // Saat gönderilmediyse mevcut değer korunur: not/mola güncellemesi barı oynatmasın.
  const start = body.plannedStart ?? existing.plannedStart
  const end = body.plannedEnd ?? existing.plannedEnd
  const range = validateRange(start, end)
  if (typeof range === "string") return NextResponse.json({ error: range }, { status: 400 })

  // Personel değişebilir (barı başka satıra taşımak): hedef personel de bu firmada olmalı.
  const employeeId = body.employeeId ?? existing.employeeId
  if (employeeId !== existing.employeeId) {
    const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId } })
    if (!employee) return NextResponse.json({ error: "Personel bulunamadı" }, { status: 404 })
  }

  // Barı başka satıra taşımak hedef personeli değiştirir: izin/tatil denetimi
  // burada da gerekli, yoksa izinli personelin satırına sürüklenen vardiya
  // sessizce kabul edilirdi. Saat/personel değişmediyse (not, mola, damga
  // güncellemesi) sorulmaz — kayıt zaten oradaydı.
  const moved = employeeId !== existing.employeeId ||
    range.start !== existing.plannedStart ||
    range.end !== existing.plannedEnd
  const workDay = utcDateToDay(existing.workDate)
  const block = await findShiftBlock(companyId, employeeId, workDay, range.start, range.end, {
    ignoreId: id,
    force: body.force === true || !moved,
  })
  if (block) return NextResponse.json({ error: block.message, code: block.code }, { status: 409 })

  // Fiilî damgalar: gönderilmediyse mevcut değer korunur, açıkça null gönderilirse silinir.
  // Devamsızlık işaretlenirse damgalar TEMİZLENİR — "gelmedi" ile "şu saatte girdi"
  // aynı kayıtta duramaz, iki ekran birbirini tutmaz.
  const absent = body.absent === true
  const rawActual = validateActual(
    body.actualStart === undefined ? existing.actualStart : body.actualStart,
    body.actualEnd === undefined ? existing.actualEnd : body.actualEnd,
  )
  if (typeof rawActual === "string") return NextResponse.json({ error: rawActual }, { status: 400 })
  const actual = absent ? { start: null, end: null } : rawActual

  const updated = await prisma.workShift.update({
    where: { id },
    data: {
      employeeId,
      plannedStart: range.start,
      plannedEnd: range.end,
      actualStart: actual.start,
      actualEnd: actual.end,
      status: statusFor(actual.start, actual.end, absent),
      ...(body.breakMinutes != null
        ? { breakMinutes: Math.max(0, Math.round(Number(body.breakMinutes) || 0)) }
        : {}),
      ...(body.note !== undefined ? { note: body.note || null } : {}),
    },
    include: SHIFT_INCLUDE,
  })

  return NextResponse.json(toShiftDto(updated))
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const { searchParams } = new URL(request.url)
  const companyId = await resolveCompanyId(searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyWrite(companyId)

  const existing = await prisma.workShift.findFirst({ where: { id, companyId } })
  if (!existing) return NextResponse.json({ error: "Vardiya bulunamadı" }, { status: 404 })

  await prisma.workShift.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
