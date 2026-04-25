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
  const notifications = await prisma.notification.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take: 20,
  })
  return NextResponse.json(notifications)
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { companyId, title, message, type, link } = await request.json()
  await ensureCompanyAccess(companyId)
  const created = await prisma.notification.create({
    data: { companyId, title, message, type: type || "INFO", link },
  })
  return NextResponse.json(created, { status: 201 })
}
