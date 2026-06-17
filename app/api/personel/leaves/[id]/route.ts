import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

const VALID_STATUSES = ["PENDING", "APPROVED", "REJECTED"]

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const existing = await prisma.leaveRecord.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "İzin kaydı bulunamadı" }, { status: 404 })
  await ensureCompanyAccess(existing.companyId)

  const body = await request.json()
  const data: any = {}
  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "Geçersiz durum" }, { status: 400 })
    }
    data.status = body.status
  }
  if (body.reason !== undefined) data.reason = body.reason || null

  const leave = await prisma.leaveRecord.update({
    where: { id },
    data,
    include: { employee: { select: { id: true, firstName: true, lastName: true, department: true } } },
  })
  return NextResponse.json(leave)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const existing = await prisma.leaveRecord.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "İzin kaydı bulunamadı" }, { status: 404 })
  await ensureCompanyAccess(existing.companyId)

  await prisma.leaveRecord.delete({ where: { id } })
  return NextResponse.json({ message: "İzin kaydı silindi" })
}
