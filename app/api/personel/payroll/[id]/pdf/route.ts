import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { buildPayslipPdf } from "@/lib/pdf/personel-pdf"

export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const rec = await prisma.payrollRecord.findUnique({
    where: { id },
    include: {
      employee: { select: { firstName: true, lastName: true, nationalId: true, position: true, department: true, iban: true } },
    },
  })
  if (!rec) return NextResponse.json({ error: "Bordro bulunamadı" }, { status: 404 })
  await ensureCompanyAccess(rec.companyId)

  const company = await prisma.company.findUnique({
    where: { id: rec.companyId },
    select: { name: true, taxNumber: true, address: true, city: true, phone: true },
  })
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 })

  const pdf = await buildPayslipPdf({
    company,
    employee: rec.employee,
    periodYear: rec.periodYear,
    periodMonth: rec.periodMonth,
    grossSalary: Number(rec.grossSalary),
    bonus: Number(rec.bonus),
    advance: Number(rec.advance),
    sgkDeduction: Number(rec.sgkDeduction),
    taxDeduction: Number(rec.taxDeduction),
    otherDeduction: Number(rec.otherDeduction),
    netSalary: Number(rec.netSalary),
    status: rec.status,
    paymentDate: rec.paymentDate ? rec.paymentDate.toISOString() : null,
  })

  const fileName = `Bordro_${rec.employee.firstName}_${rec.employee.lastName}_${rec.periodMonth}-${rec.periodYear}.pdf`
  return new NextResponse(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${encodeURIComponent(fileName)}"`,
    },
  })
}
