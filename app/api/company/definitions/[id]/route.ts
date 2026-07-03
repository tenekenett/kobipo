import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  const label = body?.label !== undefined ? String(body.label || "").trim() : undefined
  const isActive = body?.isActive !== undefined ? Boolean(body.isActive) : undefined

  const definition = await prisma.companyDefinition.findUnique({ where: { id } })
  if (!definition) return NextResponse.json({ error: "Tanım bulunamadı" }, { status: 404 })

  const access = await ensureCompanyAccess(definition.companyId)
  if (access.role === "VIEWER") {
    return NextResponse.json({ error: "Bu işlem için yetkiniz yok" }, { status: 403 })
  }

  const updated = await prisma.companyDefinition.update({
    where: { id },
    data: {
      ...(label !== undefined ? { label } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    },
  })

  return NextResponse.json(updated)
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const definition = await prisma.companyDefinition.findUnique({ where: { id } })
  if (!definition) return NextResponse.json({ error: "Tanım bulunamadı" }, { status: 404 })

  const access = await ensureCompanyAccess(definition.companyId)
  if (access.role === "VIEWER") {
    return NextResponse.json({ error: "Bu işlem için yetkiniz yok" }, { status: 403 })
  }

  await prisma.companyDefinition.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
