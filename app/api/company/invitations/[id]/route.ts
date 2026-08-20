import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

export const DELETE = withApiErrors(async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const invitation = await prisma.companyInvitation.findUnique({ where: { id } })
  if (!invitation) return NextResponse.json({ error: "Invitation not found" }, { status: 404 })

  const userCompany = await ensureCompanyAccess(invitation.companyId)
  if (userCompany.role !== "ADMIN") {
    return NextResponse.json({ error: "Only admin can delete invitations" }, { status: 403 })
  }

  await prisma.companyInvitation.delete({ where: { id } })
  return NextResponse.json({ ok: true })
})
