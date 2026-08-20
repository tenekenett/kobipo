import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

// Tek destek talebi + konuşma (talebin firmasına erişim gerekir).
export const GET = withApiErrors(async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  })
  if (!ticket) return NextResponse.json({ error: "Talep bulunamadı" }, { status: 404 })

  try {
    await ensureCompanyAccess(ticket.companyId)
  } catch {
    return NextResponse.json({ error: "Access denied" }, { status: 403 })
  }

  return NextResponse.json(ticket)
})
