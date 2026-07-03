import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function computeNet(p: { grossSalary: number; bonus: number; advance: number; sgkDeduction: number; taxDeduction: number; otherDeduction: number }) {
  return p.grossSalary + p.bonus - p.advance - p.sgkDeduction - p.taxDeduction - p.otherDeduction
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const companyId = await resolveCompanyId(searchParams.get("companyId"))
  const year = searchParams.get("year")
  const month = searchParams.get("month")
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyAccess(companyId)

  const where: any = { companyId }
  if (year) where.periodYear = Number(year)
  if (month) where.periodMonth = Number(month)

  const records = await prisma.payrollRecord.findMany({
    where,
    include: { employee: { select: { id: true, firstName: true, lastName: true, department: true } } },
    orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }, { createdAt: "desc" }],
  })
  return NextResponse.json(records)
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  body.companyId = await resolveCompanyId(body.companyId)
  const { companyId, employeeId, periodYear, periodMonth } = body
  if (!companyId || !employeeId || !periodYear || !periodMonth) {
    return NextResponse.json({ error: "companyId, employeeId, periodYear, periodMonth zorunlu" }, { status: 400 })
  }
  await ensureCompanyAccess(companyId)

  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId } })
  if (!employee) return NextResponse.json({ error: "Personel bulunamadı" }, { status: 404 })

  const parts = {
    grossSalary: num(body.grossSalary ?? employee.grossSalary ?? 0),
    bonus: num(body.bonus),
    advance: num(body.advance),
    sgkDeduction: num(body.sgkDeduction),
    taxDeduction: num(body.taxDeduction),
    otherDeduction: num(body.otherDeduction),
  }
  const netSalary = computeNet(parts)

  try {
    const record = await prisma.payrollRecord.create({
      data: {
        companyId,
        employeeId,
        periodYear: Number(periodYear),
        periodMonth: Number(periodMonth),
        ...parts,
        netSalary,
        notes: body.notes || null,
        createdBy: user.id,
      },
      include: { employee: { select: { id: true, firstName: true, lastName: true, department: true } } },
    })
    return NextResponse.json(record, { status: 201 })
  } catch (error: any) {
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "Bu personel için bu döneme ait bordro zaten var" }, { status: 409 })
    }
    throw error
  }
}
