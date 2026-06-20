import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

/**
 * Davet linki için temel URL'yi çözer. Öncelik isteğin geldiği gerçek domain'dir
 * (kullanıcı hangi adresteyse — örn. kobipo.com), böylece link Vercel önizleme
 * domaini (kobipo.vercel.app) yerine doğru adresle üretilir. Sondaki "/" temizlenir
 * ki "//invite" gibi çift slash oluşmasın.
 */
function resolveBaseUrl(request: Request): string {
  const origin = request.headers.get("origin")
  if (origin) return origin.replace(/\/+$/, "")
  const host = request.headers.get("host")
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") || "https"
    return `${proto}://${host}`.replace(/\/+$/, "")
  }
  const env =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.AUTH_URL ||
    "http://localhost:3000"
  return env.replace(/\/+$/, "")
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const companyId = new URL(request.url).searchParams.get("companyId")
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
  await ensureCompanyAccess(companyId)

  const invitations = await prisma.companyInvitation.findMany({
    where: {
      companyId,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json(invitations)
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { companyId, email, role } = await request.json()
  if (!companyId || !email || !role) {
    return NextResponse.json({ error: "companyId, email and role are required" }, { status: 400 })
  }

  const userCompany = await ensureCompanyAccess(companyId)
  if (userCompany.role !== "ADMIN") {
    return NextResponse.json({ error: "Only admin can invite users" }, { status: 403 })
  }

  const normalizedEmail = String(email).trim().toLowerCase()
  const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } })
  if (existingUser) {
    await prisma.userCompany.upsert({
      where: { userId_companyId: { userId: existingUser.id, companyId } },
      update: { role, invitedBy: user.id, invitedAt: new Date() },
      create: { userId: existingUser.id, companyId, role, invitedBy: user.id, invitedAt: new Date() },
    })
    return NextResponse.json({ status: "added", message: "Kullanıcı firmaya eklendi" }, { status: 201 })
  }

  const token = randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const invitation = await prisma.companyInvitation.create({
    data: {
      companyId,
      email: normalizedEmail,
      role,
      token,
      invitedBy: user.id,
      expiresAt,
    },
  })

  const inviteUrl = `${resolveBaseUrl(request)}/invite/${token}`

  return NextResponse.json({ status: "invited", inviteUrl, invitation }, { status: 201 })
}
