import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
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

export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const companyId = await resolveCompanyId(new URL(request.url).searchParams.get("companyId"))
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
})

export const POST = withApiErrors(async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { companyId: __cidRaw, email, role, customRoleId } = await request.json()
  const companyId = await resolveCompanyId(__cidRaw)
  if (!companyId || !email || (!role && !customRoleId)) {
    return NextResponse.json({ error: "companyId, email and role are required" }, { status: 400 })
  }

  const userCompany = await ensureCompanyAccess(companyId)
  if (userCompany.role !== "ADMIN") {
    return NextResponse.json({ error: "Only admin can invite users" }, { status: 403 })
  }

  // Özel rol seçildiyse enum CUSTOM'a düşer; rolün bu firmaya ait olduğu doğrulanır
  // (aksi halde başka firmanın rol id'si verilerek yabancı bir izin kümesi bağlanabilirdi).
  let resolvedCustomRoleId: string | null = null
  let effectiveRole = role
  if (customRoleId) {
    const target = await prisma.companyRole.findFirst({
      where: { id: String(customRoleId), companyId },
      select: { id: true },
    })
    if (!target) return NextResponse.json({ error: "Rol bu firmaya ait değil" }, { status: 400 })
    resolvedCustomRoleId = target.id
    effectiveRole = "CUSTOM"
  }

  const normalizedEmail = String(email).trim().toLowerCase()
  const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } })
  if (existingUser) {
    await prisma.userCompany.upsert({
      where: { userId_companyId: { userId: existingUser.id, companyId } },
      update: {
        role: effectiveRole,
        customRoleId: resolvedCustomRoleId,
        // Özel rolde yetki rolde durur; eski kişisel kısıt hayalet gibi kalmasın.
        ...(resolvedCustomRoleId ? { allowedPaths: [], writablePaths: [] } : {}),
        invitedBy: user.id,
        invitedAt: new Date(),
      },
      create: {
        userId: existingUser.id,
        companyId,
        role: effectiveRole,
        customRoleId: resolvedCustomRoleId,
        invitedBy: user.id,
        invitedAt: new Date(),
      },
    })
    return NextResponse.json({ status: "added", message: "Kullanıcı firmaya eklendi" }, { status: 201 })
  }

  const token = randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const invitation = await prisma.companyInvitation.create({
    data: {
      companyId,
      email: normalizedEmail,
      role: effectiveRole,
      customRoleId: resolvedCustomRoleId,
      token,
      invitedBy: user.id,
      expiresAt,
    },
  })

  const inviteUrl = `${resolveBaseUrl(request)}/invite/${token}`

  return NextResponse.json({ status: "invited", inviteUrl, invitation }, { status: 201 })
})
