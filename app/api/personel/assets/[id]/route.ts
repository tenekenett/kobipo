import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyWrite } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

export const PUT = withApiErrors(async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const existing = await prisma.assetAssignment.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Zimmet kaydı bulunamadı" }, { status: 404 })
  await ensureCompanyWrite(existing.companyId)

  const body = await request.json()
  const data: any = {}

  // İade işaretle
  if (body.action === "return") {
    data.status = "RETURNED"
    data.returnDate = body.returnDate ? new Date(body.returnDate) : new Date()
  } else if (body.action === "unreturn") {
    data.status = "ASSIGNED"
    data.returnDate = null
  } else {
    if (body.assetName !== undefined) data.assetName = String(body.assetName).trim()
    if (body.category !== undefined) data.category = body.category || null
    if (body.serialNo !== undefined) data.serialNo = body.serialNo || null
    if (body.quantity !== undefined) {
      const q = Number(body.quantity)
      data.quantity = Number.isFinite(q) && q > 0 ? Math.trunc(q) : existing.quantity
    }
    if (body.notes !== undefined) data.notes = body.notes || null
  }

  const asset = await prisma.assetAssignment.update({
    where: { id },
    data,
    include: { employee: { select: { id: true, firstName: true, lastName: true, department: true } } },
  })
  return NextResponse.json(asset)
})

export const DELETE = withApiErrors(async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const existing = await prisma.assetAssignment.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Zimmet kaydı bulunamadı" }, { status: 404 })
  await ensureCompanyWrite(existing.companyId)

  await prisma.assetAssignment.delete({ where: { id } })
  return NextResponse.json({ message: "Zimmet kaydı silindi" })
})
