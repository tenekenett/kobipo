import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

export const GET = withApiErrors(async function GET(request: Request) {
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

  const assets = await prisma.assetAssignment.findMany({
    where,
    include: { employee: { select: { id: true, firstName: true, lastName: true, department: true } } },
    orderBy: { assignedDate: "desc" },
  })
  return NextResponse.json(assets)
})

export const POST = withApiErrors(async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  body.companyId = await resolveCompanyId(body.companyId)
  const { companyId, employeeId, assetName } = body
  if (!companyId || !employeeId || !assetName) {
    return NextResponse.json({ error: "companyId, employeeId, assetName zorunlu" }, { status: 400 })
  }
  await ensureCompanyWrite(companyId)

  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId } })
  if (!employee) return NextResponse.json({ error: "Personel bulunamadı" }, { status: 404 })

  const qty = Number(body.quantity)
  const asset = await prisma.assetAssignment.create({
    data: {
      companyId,
      employeeId,
      assetName: String(assetName).trim(),
      category: body.category || null,
      serialNo: body.serialNo || null,
      quantity: Number.isFinite(qty) && qty > 0 ? Math.trunc(qty) : 1,
      assignedDate: body.assignedDate ? new Date(body.assignedDate) : new Date(),
      notes: body.notes || null,
      createdBy: user.id,
    },
    include: { employee: { select: { id: true, firstName: true, lastName: true, department: true } } },
  })
  return NextResponse.json(asset, { status: 201 })
})
