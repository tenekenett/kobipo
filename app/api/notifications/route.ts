import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const searchParams = new URL(request.url).searchParams
  const companyId = searchParams.get("companyId")
  const mode = searchParams.get("mode")
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
  await ensureCompanyAccess(companyId)
  if (mode === "count") {
    const unreadCount = await prisma.notification.count({
      where: { companyId, isRead: false },
    })
    return NextResponse.json({ unreadCount })
  }
  const notifications = await prisma.notification.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take: 20,
  })
  return NextResponse.json(notifications)
}

// Okundu işaretleme: { companyId, all: true } tümünü, { companyId, id } tek bildirimi.
export async function PATCH(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { companyId, id, all } = await request.json()
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
  await ensureCompanyAccess(companyId)

  if (all) {
    await prisma.notification.updateMany({
      where: { companyId, isRead: false },
      data: { isRead: true },
    })
  } else if (id) {
    // companyId ile scope'la — başka firmanın bildirimi işaretlenmesin.
    await prisma.notification.updateMany({
      where: { id, companyId },
      data: { isRead: true },
    })
  } else {
    return NextResponse.json({ error: "id veya all gerekli" }, { status: 400 })
  }

  const unreadCount = await prisma.notification.count({ where: { companyId, isRead: false } })
  return NextResponse.json({ ok: true, unreadCount })
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
