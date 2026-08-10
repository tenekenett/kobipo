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
  const members = await prisma.userCompany.findMany({
    where: { companyId },
    select: {
      id: true,
      role: true,
      createdAt: true,
      // Yetki dialogunun ön dolumu; boş dizi = kısıt yok (bkz. lib/page-access.ts).
      allowedPaths: true,
      writablePaths: true,
      customRoleId: true,
      customRole: { select: { id: true, name: true, allowedPaths: true, writablePaths: true } },
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json(members)
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json()
  body.companyId = await resolveCompanyId(body.companyId)
  const { companyId, email, role, customRoleId } = body
  if (!companyId || !email || (!role && !customRoleId)) {
    return NextResponse.json({ error: "companyId, email and role are required" }, { status: 400 })
  }
  const uc = await ensureCompanyAccess(companyId)
  if (uc.role !== "ADMIN") return NextResponse.json({ error: "Only admin can invite" }, { status: 403 })

  const targetUser = await prisma.user.findUnique({ where: { email } })
  if (!targetUser) {
    return NextResponse.json({ error: "User not found. Kayıtlı kullanıcı e-postası girin." }, { status: 404 })
  }

  // Özel rol seçildiyse enum CUSTOM'a düşer; rolün bu firmaya ait olduğu doğrulanır.
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

  const member = await prisma.userCompany.upsert({
    where: { userId_companyId: { userId: targetUser.id, companyId } },
    update: {
      role: effectiveRole,
      customRoleId: resolvedCustomRoleId,
      ...(resolvedCustomRoleId ? { allowedPaths: [], writablePaths: [] } : {}),
      invitedBy: user.id,
      invitedAt: new Date(),
    },
    create: {
      userId: targetUser.id,
      companyId,
      role: effectiveRole,
      customRoleId: resolvedCustomRoleId,
      invitedBy: user.id,
      invitedAt: new Date(),
    },
  })
  return NextResponse.json(member, { status: 201 })
}
