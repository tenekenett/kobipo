import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

// Kullanıcının destek talebine yanıt eklemesi.
export const POST = withApiErrors(async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const { body } = await request.json()
  const text = String(body || "").trim()
  if (!text) return NextResponse.json({ error: "Mesaj boş olamaz" }, { status: 400 })

  const ticket = await prisma.supportTicket.findUnique({ where: { id } })
  if (!ticket) return NextResponse.json({ error: "Talep bulunamadı" }, { status: 404 })

  try {
    await ensureCompanyAccess(ticket.companyId)
  } catch {
    return NextResponse.json({ error: "Access denied" }, { status: 403 })
  }

  const message = await prisma.supportTicketMessage.create({
    data: { ticketId: id, authorId: user.id, isAdmin: false, body: text },
  })

  // Kullanıcı yanıt verince talep yeniden "açık" duruma gelir (kapalıysa da).
  await prisma.supportTicket.update({
    where: { id },
    data: { status: "OPEN" },
  })

  return NextResponse.json(message, { status: 201 })
})
