import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

// Aktif personel başına yıllık izin bakiyesi: hak (annualLeaveDays) − seçili yıl
// onaylanmış YILLIK (ANNUAL) izin günleri = kalan.
export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const companyId = await resolveCompanyId(searchParams.get("companyId"))
  const year = Number(searchParams.get("year")) || new Date().getFullYear()
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyAccess(companyId)

  const start = new Date(year, 0, 1)
  const end = new Date(year, 11, 31, 23, 59, 59)

  const [employees, annualLeaves] = await Promise.all([
    prisma.employee.findMany({
      where: { companyId, status: { not: "TERMINATED" } },
      select: { id: true, firstName: true, lastName: true, department: true, annualLeaveDays: true },
      orderBy: { firstName: "asc" },
    }),
    prisma.leaveRecord.findMany({
      where: { companyId, type: "ANNUAL", status: "APPROVED", startDate: { gte: start, lte: end } },
      select: { employeeId: true, days: true },
    }),
  ])

  const usedByEmployee = new Map<string, number>()
  for (const l of annualLeaves) {
    usedByEmployee.set(l.employeeId, (usedByEmployee.get(l.employeeId) || 0) + Number(l.days))
  }

  const balances = employees.map((e) => {
    const entitlement = e.annualLeaveDays ?? 14
    const used = usedByEmployee.get(e.id) || 0
    return {
      employeeId: e.id,
      name: `${e.firstName} ${e.lastName}`,
      department: e.department,
      entitlement,
      used,
      remaining: entitlement - used,
    }
  })

  return NextResponse.json({ year, balances })
})
