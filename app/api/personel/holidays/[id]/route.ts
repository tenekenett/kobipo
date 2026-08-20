import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyWrite } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

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

  const existing = await prisma.companyHoliday.findFirst({ where: { id, companyId } })
  if (!existing) return NextResponse.json({ error: "Tatil bulunamadı" }, { status: 404 })

  // Tatil kaydı silinince o güne yazılmış vardiyalara DOKUNULMAZ: tatilde
  // çalışılmış olabilir ve planı silmek veri kaybı olurdu.
  await prisma.companyHoliday.delete({ where: { id } })
  return NextResponse.json({ ok: true })
})
