import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const companyId = new URL(request.url).searchParams.get("companyId")
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
  await ensureCompanyAccess(companyId)
  const tickets = await prisma.supportTicket.findMany({ where: { companyId }, orderBy: { createdAt: "desc" } })
  return NextResponse.json(tickets)
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { companyId, subject, message } = await request.json()
  await ensureCompanyAccess(companyId)
  const ticket = await prisma.supportTicket.create({
    data: { companyId, subject, message, createdById: user.id },
  })
  return NextResponse.json(ticket, { status: 201 })
}
