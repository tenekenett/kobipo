import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { buildAssetFormPdf } from "@/lib/pdf/personel-pdf"

export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const rec = await prisma.assetAssignment.findUnique({
    where: { id },
    include: { employee: { select: { firstName: true, lastName: true, nationalId: true, position: true, department: true } } },
  })
  if (!rec) return NextResponse.json({ error: "Zimmet kaydı bulunamadı" }, { status: 404 })
  await ensureCompanyAccess(rec.companyId)

  const company = await prisma.company.findUnique({
    where: { id: rec.companyId },
    select: { name: true, taxNumber: true, address: true, city: true, phone: true },
  })
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 })

  const pdf = await buildAssetFormPdf({
    company,
    employee: rec.employee,
    assetName: rec.assetName,
    category: rec.category,
    serialNo: rec.serialNo,
    quantity: rec.quantity,
    assignedDate: rec.assignedDate.toISOString(),
    returnDate: rec.returnDate ? rec.returnDate.toISOString() : null,
    status: rec.status,
    notes: rec.notes,
  })

  const fileName = `Zimmet_${rec.employee.firstName}_${rec.employee.lastName}.pdf`
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${encodeURIComponent(fileName)}"`,
    },
  })
}
