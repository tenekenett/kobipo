import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyWrite } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

const VALID_STATUSES = ["PENDING", "APPROVED", "REJECTED"]

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const existing = await prisma.leaveRecord.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "İzin kaydı bulunamadı" }, { status: 404 })
  await ensureCompanyWrite(existing.companyId)

  const body = await request.json()
  const data: any = {}
  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "Geçersiz durum" }, { status: 400 })
    }
    data.status = body.status
  }
  if (body.reason !== undefined) data.reason = body.reason || null

  /**
   * ONAYLARKEN vardiya denetimi.
   *
   * Denetim şimdiye kadar tek yönlüydü: vardiya açılırken izne bakılıyordu ama
   * izin onaylanırken o günlerdeki vardiyalara bakılmıyordu. Sonuç, aynı günün
   * hem izinli hem planlı çalışma sayılması ve puantajın iki kez dolmasıydı.
   *
   * Bulunan vardiyalar 409 ile bildirilir; kullanıcı onaylarsa `removeShifts`
   * ile istek tekrarlanır ve YALNIZ PLANLI olanlar silinir. Damgalı vardiya
   * korunur: fiilen çalışılmış saat, sonradan onaylanan bir izin yüzünden
   * silinemez (yarım gün çalışıp raporlu ayrılan personel olağandır).
   */
  if (data.status === "APPROVED" && existing.status !== "APPROVED") {
    const clash = await prisma.workShift.findMany({
      where: {
        companyId: existing.companyId,
        employeeId: existing.employeeId,
        workDate: { gte: existing.startDate, lte: existing.endDate },
      },
      select: { id: true, status: true, actualStart: true, actualEnd: true },
    })
    const planned = clash.filter(
      (s) => s.status === "PLANNED" && s.actualStart == null && s.actualEnd == null,
    )
    const stamped = clash.length - planned.length

    if (clash.length > 0 && body.removeShifts !== true) {
      return NextResponse.json(
        {
          code: "SHIFTS",
          error: `İzin günlerinde ${clash.length} vardiya var`,
          planned: planned.length,
          stamped,
        },
        { status: 409 },
      )
    }
    if (planned.length > 0) {
      await prisma.workShift.deleteMany({ where: { id: { in: planned.map((s) => s.id) } } })
    }
  }

  const leave = await prisma.leaveRecord.update({
    where: { id },
    data,
    include: { employee: { select: { id: true, firstName: true, lastName: true, department: true } } },
  })
  return NextResponse.json(leave)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const existing = await prisma.leaveRecord.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "İzin kaydı bulunamadı" }, { status: 404 })
  await ensureCompanyWrite(existing.companyId)

  await prisma.leaveRecord.delete({ where: { id } })
  return NextResponse.json({ message: "İzin kaydı silindi" })
}
