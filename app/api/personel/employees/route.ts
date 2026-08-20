import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { isValidTcKimlik } from "@/lib/personel/validation"

export const dynamic = "force-dynamic"

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function dateOrNull(v: unknown): Date | null {
  if (!v) return null
  const d = new Date(v as string)
  return Number.isNaN(d.getTime()) ? null : d
}

export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const companyId = await resolveCompanyId(searchParams.get("companyId"))
  const status = searchParams.get("status")
  const search = searchParams.get("search")
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyAccess(companyId)

  const where: any = { companyId }
  if (status) where.status = status
  if (search && search.trim()) {
    const q = search.trim()
    where.OR = [
      { firstName: { contains: q, mode: "insensitive" } },
      { lastName: { contains: q, mode: "insensitive" } },
      { nationalId: { contains: q } },
      { department: { contains: q, mode: "insensitive" } },
      { position: { contains: q, mode: "insensitive" } },
    ]
  }

  const employees = await prisma.employee.findMany({
    where,
    orderBy: [{ status: "asc" }, { firstName: "asc" }],
  })
  return NextResponse.json(employees)
})

export const POST = withApiErrors(async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  body.companyId = await resolveCompanyId(body.companyId)
  const { companyId, firstName, lastName } = body
  if (!companyId || !firstName || !lastName) {
    return NextResponse.json({ error: "companyId, firstName ve lastName zorunludur" }, { status: 400 })
  }
  if (body.nationalId && String(body.nationalId).trim() && !isValidTcKimlik(body.nationalId)) {
    return NextResponse.json({ error: "Geçersiz T.C. Kimlik No" }, { status: 400 })
  }
  await ensureCompanyWrite(companyId)

  const employee = await prisma.employee.create({
    data: {
      companyId,
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      nationalId: body.nationalId || null,
      email: body.email || null,
      phone: body.phone || null,
      birthDate: dateOrNull(body.birthDate),
      department: body.department || null,
      position: body.position || null,
      hireDate: dateOrNull(body.hireDate),
      grossSalary: numOrNull(body.grossSalary),
      iban: body.iban || null,
      address: body.address || null,
      emergencyContact: body.emergencyContact || null,
      annualLeaveDays: numOrNull(body.annualLeaveDays) ?? 14,
      status: body.status === "TERMINATED" || body.status === "ON_LEAVE" ? body.status : "ACTIVE",
      notes: body.notes || null,
      createdBy: user.id,
    },
  })
  return NextResponse.json(employee, { status: 201 })
})
