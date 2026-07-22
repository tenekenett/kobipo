import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const { companyId: __cidRaw, role } = await request.json()
  const companyId = await resolveCompanyId(__cidRaw)
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
  const uc = await ensureCompanyAccess(companyId)
  if (uc.role !== "ADMIN") return NextResponse.json({ error: "Only admin can update role" }, { status: 403 })
  // IDOR koruması: hedef üyelik gerçekten bu firmaya ait olmalı. Aksi halde bir firma
  // admini, başka firmanın üyelik id'sini vererek o üyeliğin rolünü değiştirebilirdi.
  const membership = await prisma.userCompany.findFirst({ where: { id, companyId } })
  if (!membership) return NextResponse.json({ error: "Üye bulunamadı" }, { status: 404 })
  const updated = await prisma.userCompany.update({ where: { id }, data: { role } })
  return NextResponse.json(updated)
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const companyId = await resolveCompanyId(new URL(request.url).searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
  const uc = await ensureCompanyAccess(companyId)
  if (uc.role !== "ADMIN") return NextResponse.json({ error: "Only admin can remove member" }, { status: 403 })
  // IDOR koruması: hedef üyelik gerçekten bu firmaya ait olmalı (bkz. PATCH).
  const membership = await prisma.userCompany.findFirst({ where: { id, companyId } })
  if (!membership) return NextResponse.json({ error: "Üye bulunamadı" }, { status: 404 })
  await prisma.userCompany.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
