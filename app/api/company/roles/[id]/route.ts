import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { sanitizePagePermissions } from "@/lib/page-access"

export const dynamic = "force-dynamic"

/** Hedef rolün gerçekten bu firmaya ait olduğunu doğrular (cross-tenant IDOR koruması). */
async function loadRole(id: string, companyId: string) {
  return prisma.companyRole.findFirst({ where: { id, companyId }, select: { id: true } })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  const body = await request.json()
  const companyId = await resolveCompanyId(body.companyId)
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  const context = await ensureCompanyAccess(companyId)
  if (context.role !== "ADMIN") {
    return NextResponse.json({ error: "Rol düzenlemeye yalnız firma yöneticisi yetkilidir" }, { status: 403 })
  }
  if (!(await loadRole(id, companyId))) {
    return NextResponse.json({ error: "Rol bulunamadı" }, { status: 404 })
  }

  const data: Record<string, unknown> = {}
  if (typeof body.name === "string") {
    const name = body.name.trim()
    if (!name) return NextResponse.json({ error: "Rol adı boş olamaz" }, { status: 400 })
    data.name = name
  }
  if (body.description !== undefined) {
    data.description = typeof body.description === "string" ? body.description.trim() || null : null
  }
  // Kalıp bağı yalnız DOLU gelirse yazılır. Kullanıcı kalıp kartından girip adı çakışan
  // mevcut rolü güncellediğinde kart bir dahakine "Oluşturuldu" diyebilsin diye; ama
  // kalıpsız düzenleme (undefined) mevcut bağı SİLMEMELİ.
  if (typeof body.templateKey === "string" && body.templateKey) {
    data.templateKey = body.templateKey
  }
  if (body.allowedPaths !== undefined || body.writablePaths !== undefined) {
    const sanitized = sanitizePagePermissions("CUSTOM", body.allowedPaths, body.writablePaths, {
      custom: true,
    })
    if (sanitized.allowedPaths.length === 0) {
      return NextResponse.json({ error: "Role en az bir sayfa yetkisi verin" }, { status: 400 })
    }
    data.allowedPaths = sanitized.allowedPaths
    data.writablePaths = sanitized.writablePaths
  }

  try {
    const role = await prisma.companyRole.update({ where: { id }, data })
    return NextResponse.json(role)
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "Bu isimde bir rol zaten var" }, { status: 409 })
    }
    throw error
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const companyId = await resolveCompanyId(new URL(request.url).searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  const context = await ensureCompanyAccess(companyId)
  if (context.role !== "ADMIN") {
    return NextResponse.json({ error: "Rol silmeye yalnız firma yöneticisi yetkilidir" }, { status: 403 })
  }
  if (!(await loadRole(id, companyId))) {
    return NextResponse.json({ error: "Rol bulunamadı" }, { status: 404 })
  }

  // Kullanımdaki rolü silmeyi engelliyoruz. FK zaten SET NULL yapardı ama o durumda
  // çalışanlar sessizce enum rollerine düşer ve yetkileri fark edilmeden değişirdi;
  // yöneticinin önce kimin ne olacağına karar vermesi gerekir.
  const inUse = await prisma.userCompany.count({ where: { customRoleId: id } })
  if (inUse > 0) {
    return NextResponse.json(
      { error: `Bu rol ${inUse} çalışanda kullanılıyor. Önce onlara başka bir rol atayın.` },
      { status: 409 }
    )
  }

  await prisma.companyRole.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
