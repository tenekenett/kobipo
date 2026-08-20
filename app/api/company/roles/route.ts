import { accessDeniedResponse, isAccessDeniedError, withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { sanitizePagePermissions } from "@/lib/page-access"

export const dynamic = "force-dynamic"

/**
 * Firmanın kendi tanımladığı roller.
 *
 * Rol OLUŞTURMAK yetki dağıtmaktır, o yüzden yalnız enum ADMIN yapabilir — özel rol
 * sahibine devredilemez (bkz. lib/nav/pages.ts → ACCOUNT_ADMIN_PAGES). Sayfa listesi
 * sunucuda `sanitizePagePermissions(..., { custom: true })` ile süzülür: hesap yönetimi
 * ekranları istemci ne gönderirse göndersin listeye giremez.
 */

export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const companyId = await resolveCompanyId(new URL(request.url).searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
  await ensureCompanyAccess(companyId)

  const roles = await prisma.companyRole.findMany({
    where: { companyId },
    orderBy: { name: "asc" },
    include: { _count: { select: { members: true } } },
  })
  return NextResponse.json(roles)
})

export const POST = withApiErrors(async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const companyId = await resolveCompanyId(body.companyId)
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  const context = await ensureCompanyAccess(companyId)
  if (context.role !== "ADMIN") {
    return NextResponse.json({ error: "Rol tanımlamaya yalnız firma yöneticisi yetkilidir" }, { status: 403 })
  }

  const name = typeof body.name === "string" ? body.name.trim() : ""
  if (!name) return NextResponse.json({ error: "Rol adı zorunludur" }, { status: 400 })

  const { allowedPaths, writablePaths } = sanitizePagePermissions(
    "CUSTOM",
    body.allowedPaths,
    body.writablePaths,
    { custom: true }
  )
  if (allowedPaths.length === 0) {
    return NextResponse.json({ error: "Role en az bir sayfa yetkisi verin" }, { status: 400 })
  }

  try {
    const role = await prisma.companyRole.create({
      data: {
        companyId,
        name,
        description: typeof body.description === "string" ? body.description.trim() || null : null,
        templateKey: typeof body.templateKey === "string" ? body.templateKey : null,
        allowedPaths,
        writablePaths,
        createdBy: user.id,
      },
    })
    return NextResponse.json(role, { status: 201 })
  } catch (error) {
    // Kapı reddi (modül/sayfa/rol) 403 döner; buradaki diğer dallar veri hatası içindir.
    if (isAccessDeniedError(error)) return accessDeniedResponse(error)
    if (error && typeof error === "object" && (error as { code?: string }).code === "P2002") {
      // Çakışan rolün id'sini de döndürüyoruz. 409'un tipik sebebi kullanıcının hata
      // yapması değil, arayüzün "düzenle" yerine "yeni rol" akışını açmasıdır (hazır
      // kalıp kartı, ekip ekranındaki düğme). id olmadan kullanıcı çıkmaz sokakta kalır;
      // bununla diyalog doğrudan o rolün düzenlemesine geçebiliyor.
      const existing = await prisma.companyRole.findFirst({
        where: { companyId, name },
        select: { id: true },
      })
      return NextResponse.json(
        { error: "Bu isimde bir rol zaten var", existingRoleId: existing?.id ?? null },
        { status: 409 }
      )
    }
    throw error
  }
})
