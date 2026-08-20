import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyWrite } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

// Seçili dönemde bordrosu olmayan tüm AKTİF personele, kayıtlı brüt maaşları
// üzerinden taslak (PENDING) bordro oluşturur. Var olanlara dokunmaz.
export const POST = withApiErrors(async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  body.companyId = await resolveCompanyId(body.companyId)
  const { companyId, periodYear, periodMonth } = body
  if (!companyId || !periodYear || !periodMonth) {
    return NextResponse.json({ error: "companyId, periodYear, periodMonth zorunlu" }, { status: 400 })
  }
  await ensureCompanyWrite(companyId)

  const [employees, existing] = await Promise.all([
    prisma.employee.findMany({ where: { companyId, status: "ACTIVE" }, select: { id: true, grossSalary: true } }),
    prisma.payrollRecord.findMany({
      where: { companyId, periodYear: Number(periodYear), periodMonth: Number(periodMonth) },
      select: { employeeId: true },
    }),
  ])

  const taken = new Set(existing.map((e) => e.employeeId))
  const toCreate = employees.filter((e) => !taken.has(e.id))

  if (toCreate.length === 0) {
    return NextResponse.json({ created: 0, message: "Bu dönemde bordrosu olmayan aktif personel yok" })
  }

  await prisma.payrollRecord.createMany({
    data: toCreate.map((e) => {
      const gross = Number(e.grossSalary || 0)
      return {
        companyId,
        employeeId: e.id,
        periodYear: Number(periodYear),
        periodMonth: Number(periodMonth),
        grossSalary: gross,
        netSalary: gross, // kesinti yok → net = brüt; kullanıcı sonra düzenler
        createdBy: user.id,
      }
    }),
    skipDuplicates: true,
  })

  return NextResponse.json({ created: toCreate.length })
})
