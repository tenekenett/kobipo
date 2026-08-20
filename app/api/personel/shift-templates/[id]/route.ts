import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { validateRange } from "@/lib/personel/shift-api"

export const dynamic = "force-dynamic"

export const PATCH = withApiErrors(async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  const companyId = await resolveCompanyId(body.companyId)
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyWrite(companyId)

  const existing = await prisma.shiftTemplate.findFirst({ where: { id, companyId } })
  if (!existing) return NextResponse.json({ error: "Şablon bulunamadı" }, { status: 404 })

  const range = validateRange(
    body.startMinute ?? existing.startMinute,
    body.endMinute ?? existing.endMinute,
  )
  if (typeof range === "string") return NextResponse.json({ error: range }, { status: 400 })

  const updated = await prisma.shiftTemplate.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: String(body.name).trim() || existing.name } : {}),
      startMinute: range.start,
      endMinute: range.end,
      ...(body.breakMinutes != null
        ? { breakMinutes: Math.max(0, Math.round(Number(body.breakMinutes) || 0)) }
        : {}),
      ...(body.color !== undefined ? { color: body.color || null } : {}),
    },
  })
  return NextResponse.json(updated)
})

/**
 * Şablon silme = pasife alma.
 *
 * Gerçekten silinseydi, şablondan üretilmiş vardiyaların `templateId`'si null'a
 * düşer ve geçmiş takvimdeki barlar rengini/adını kaybederdi. Pasif şablon
 * listede çıkmaz ama eski vardiyalar bozulmadan kalır.
 */
export const DELETE = withApiErrors(async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const { searchParams } = new URL(request.url)
  const companyId = await resolveCompanyId(searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyWrite(companyId)

  const existing = await prisma.shiftTemplate.findFirst({ where: { id, companyId } })
  if (!existing) return NextResponse.json({ error: "Şablon bulunamadı" }, { status: 404 })

  await prisma.shiftTemplate.update({ where: { id }, data: { isActive: false } })
  return NextResponse.json({ ok: true })
})
