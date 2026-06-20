import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { prisma } from "@/lib/db/prisma"

export const dynamic = "force-dynamic"

// Sistem-admin'in destek talebine yanıtı. Talebi ANSWERED yapar ve ilgili
// firmaya uygulama-içi bildirim düşer (kullanıcı yanıtı görsün).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  const { id } = await params
  const { body } = await request.json()
  const text = String(body || "").trim()
  if (!text) return NextResponse.json({ error: "Mesaj boş olamaz" }, { status: 400 })

  const ticket = await prisma.supportTicket.findUnique({ where: { id } })
  if (!ticket) return NextResponse.json({ error: "Talep bulunamadı" }, { status: 404 })

  const message = await prisma.supportTicketMessage.create({
    data: { ticketId: id, authorId: auth.user.id, isAdmin: true, body: text },
  })

  await prisma.supportTicket.update({ where: { id }, data: { status: "ANSWERED" } })

  // Firmaya bildirim (best-effort).
  try {
    await prisma.notification.create({
      data: {
        companyId: ticket.companyId,
        title: "Destek talebinize yanıt verildi",
        message: `"${ticket.subject}" talebinize destek ekibi yanıt yazdı.`,
        type: "INFO",
        link: "/ayarlar/destek",
      },
    })
  } catch {
    // bildirim oluşturulamazsa yanıt yine de başarılı sayılır
  }

  return NextResponse.json(message, { status: 201 })
}
