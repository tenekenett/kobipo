import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { prisma } from "@/lib/db/prisma"

export const dynamic = "force-dynamic"

const VALID_STATUS = ["OPEN", "ANSWERED", "CLOSED"]

// Tek talep detayı (sistem-admin).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  const { id } = await params
  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  })
  if (!ticket) return NextResponse.json({ error: "Talep bulunamadı" }, { status: 404 })
  return NextResponse.json(ticket)
}

// Durum değiştir (OPEN/ANSWERED/CLOSED).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  const { id } = await params
  const { status } = await request.json()
  if (!VALID_STATUS.includes(status)) {
    return NextResponse.json({ error: "Geçersiz durum" }, { status: 400 })
  }

  const exists = await prisma.supportTicket.findUnique({ where: { id }, select: { id: true } })
  if (!exists) return NextResponse.json({ error: "Talep bulunamadı" }, { status: 404 })

  const updated = await prisma.supportTicket.update({ where: { id }, data: { status } })
  return NextResponse.json(updated)
}
