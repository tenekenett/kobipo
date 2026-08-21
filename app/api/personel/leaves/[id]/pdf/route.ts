import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyExport } from "@/lib/middleware/company"
import { buildLeaveFormPdf } from "@/lib/pdf/personel-pdf"

export const dynamic = "force-dynamic"

export const GET = withApiErrors(async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const rec = await prisma.leaveRecord.findUnique({
    where: { id },
    include: { employee: { select: { firstName: true, lastName: true, nationalId: true, position: true, department: true } } },
  })
  if (!rec) return NextResponse.json({ error: "İzin kaydı bulunamadı" }, { status: 404 })
  await ensureCompanyExport(rec.companyId)

  const company = await prisma.company.findUnique({
    where: { id: rec.companyId },
    select: { name: true, taxNumber: true, address: true, city: true, phone: true },
  })
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 })

  const pdf = await buildLeaveFormPdf({
    company,
    employee: rec.employee,
    type: rec.type,
    startDate: rec.startDate.toISOString(),
    endDate: rec.endDate.toISOString(),
    days: Number(rec.days),
    reason: rec.reason,
    status: rec.status,
  })

  const fileName = `Izin_${rec.employee.firstName}_${rec.employee.lastName}.pdf`
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${encodeURIComponent(fileName)}"`,
    },
  })
})
