import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const { companyId, role } = await request.json()
  const uc = await ensureCompanyAccess(companyId)
  if (uc.role !== "ADMIN") return NextResponse.json({ error: "Only admin can update role" }, { status: 403 })
  const updated = await prisma.userCompany.update({ where: { id }, data: { role } })
  return NextResponse.json(updated)
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const companyId = new URL(request.url).searchParams.get("companyId")
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
  const uc = await ensureCompanyAccess(companyId)
  if (uc.role !== "ADMIN") return NextResponse.json({ error: "Only admin can remove member" }, { status: 403 })
  await prisma.userCompany.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
