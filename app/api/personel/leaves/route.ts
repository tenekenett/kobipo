import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

const DAY_MS = 24 * 60 * 60 * 1000
const VALID_TYPES = ["ANNUAL", "EXCUSE", "SICK", "UNPAID"]

function inclusiveDays(start: Date, end: Date): number {
  const d = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1
  return d > 0 ? d : 1
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const companyId = await resolveCompanyId(searchParams.get("companyId"))
  const status = searchParams.get("status")
  const employeeId = searchParams.get("employeeId")
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyAccess(companyId)

  const where: any = { companyId }
  if (status) where.status = status
  if (employeeId) where.employeeId = employeeId

  const leaves = await prisma.leaveRecord.findMany({
    where,
    include: { employee: { select: { id: true, firstName: true, lastName: true, department: true } } },
    orderBy: { startDate: "desc" },
  })
  return NextResponse.json(leaves)
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  body.companyId = await resolveCompanyId(body.companyId)
  const { companyId, employeeId, type, startDate, endDate } = body
  if (!companyId || !employeeId || !type || !startDate || !endDate) {
    return NextResponse.json({ error: "companyId, employeeId, type, startDate, endDate zorunlu" }, { status: 400 })
  }
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: "Geçersiz izin türü" }, { status: 400 })
  }
  await ensureCompanyWrite(companyId)

  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId } })
  if (!employee) return NextResponse.json({ error: "Personel bulunamadı" }, { status: 404 })

  const start = new Date(startDate)
  const end = new Date(endDate)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return NextResponse.json({ error: "Geçersiz tarih aralığı" }, { status: 400 })
  }
  const days = body.days != null && Number(body.days) > 0 ? Number(body.days) : inclusiveDays(start, end)

  const leave = await prisma.leaveRecord.create({
    data: {
      companyId,
      employeeId,
      type,
      startDate: start,
      endDate: end,
      days,
      reason: body.reason || null,
      createdBy: user.id,
    },
    include: { employee: { select: { id: true, firstName: true, lastName: true, department: true } } },
  })
  return NextResponse.json(leave, { status: 201 })
}
