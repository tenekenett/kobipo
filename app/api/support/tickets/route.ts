import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const companyId = await resolveCompanyId(new URL(request.url).searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
  await ensureCompanyAccess(companyId)
  const tickets = await prisma.supportTicket.findMany({
    where: { companyId },
    orderBy: { updatedAt: "desc" },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  })
  return NextResponse.json(tickets)
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { companyId: __cidRaw, subject, message, accessConsent } = await request.json()
  const companyId = await resolveCompanyId(__cidRaw)
  const subj = String(subject || "").trim()
  const msg = String(message || "").trim()
  if (!companyId || !subj || !msg) {
    return NextResponse.json({ error: "companyId, konu ve mesaj zorunlu" }, { status: 400 })
  }
  if (accessConsent !== true) {
    return NextResponse.json(
      { error: "Talep oluşturmak için hesap erişim izni onayı gerekir." },
      { status: 400 },
    )
  }
  await ensureCompanyAccess(companyId)
  const ticket = await prisma.supportTicket.create({
    data: {
      companyId,
      subject: subj,
      message: msg,
      createdById: user.id,
      status: "OPEN",
      accessConsent: accessConsent === true,
    },
  })
  return NextResponse.json(ticket, { status: 201 })
}
