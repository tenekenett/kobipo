import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const fullUser = await prisma.user.findUnique({ where: { id: user.id }, select: { isSuperAdmin: true } })
  if (!fullUser?.isSuperAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const limit = Number(new URL(request.url).searchParams.get("limit") || 50)
  const logs = await prisma.systemLog.findMany({ orderBy: { createdAt: "desc" }, take: limit })
  return NextResponse.json({ logs })
}
