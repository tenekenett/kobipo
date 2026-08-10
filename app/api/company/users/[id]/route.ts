import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { sanitizePagePermissions } from "@/lib/page-access"

export const dynamic = "force-dynamic"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const { companyId: __cidRaw, role, allowedPaths, writablePaths, customRoleId } = await request.json()
  const companyId = await resolveCompanyId(__cidRaw)
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
  const uc = await ensureCompanyAccess(companyId)
  if (uc.role !== "ADMIN") return NextResponse.json({ error: "Only admin can update role" }, { status: 403 })
  // IDOR koruması: hedef üyelik gerçekten bu firmaya ait olmalı. Aksi halde bir firma
  // admini, başka firmanın üyelik id'sini vererek o üyeliğin rolünü değiştirebilirdi.
  const membership = await prisma.userCompany.findFirst({ where: { id, companyId } })
  if (!membership) return NextResponse.json({ error: "Üye bulunamadı" }, { status: 404 })

  const data: {
    role?: string
    allowedPaths?: string[]
    writablePaths?: string[]
    customRoleId?: string | null
  } = {}
  if (role !== undefined) data.role = role

  // Özel rol ataması. Rol ve enum birlikte yürür: özel rol atanınca enum CUSTOM olur
  // (kodun geri kalanı "ne ADMIN ne VIEWER" kararını oradan verir), kaldırılınca
  // çağıranın verdiği enum role döner — verilmediyse VIEWER, yani en dar hâl.
  if (customRoleId !== undefined) {
    if (customRoleId === null || customRoleId === "") {
      data.customRoleId = null
      if (role === undefined) data.role = "VIEWER"
    } else {
      const target = await prisma.companyRole.findFirst({
        where: { id: String(customRoleId), companyId },
        select: { id: true },
      })
      if (!target) {
        return NextResponse.json({ error: "Rol bu firmaya ait değil" }, { status: 400 })
      }
      data.customRoleId = target.id
      data.role = "CUSTOM"
      // Özel rolde yetki ROLDE durur; üyelikteki kişisel listeler temizlenir ki
      // "rolü değiştirdim ama eski kısıt duruyor" gibi bir hayalet kalmasın.
      data.allowedPaths = []
      data.writablePaths = []
    }
  }

  // İzinler yalnız İKİSİ BİRDEN gönderildiğinde yazılır: yazma listesi görüntüleme
  // listesinin alt kümesi olmak zorunda ve ikisini ayrı isteklerle güncellemek arada
  // tutarsız bir an bırakırdı.
  // Özel rol atandıysa kişisel liste yukarıda temizlendi; ikisi birden gönderilirse
  // rol kazanır (yetkinin tek kaynağı belirsiz kalmasın).
  if (data.customRoleId == null && (allowedPaths !== undefined || writablePaths !== undefined)) {
    // Rol de aynı istekte değişiyor olabilir; kesişim YENİ role göre alınmalı.
    const effectiveRole = (role as string | undefined) ?? membership.role
    const sanitized = sanitizePagePermissions(effectiveRole, allowedPaths, writablePaths)
    data.allowedPaths = sanitized.allowedPaths
    data.writablePaths = sanitized.writablePaths
  }

  const updated = await prisma.userCompany.update({ where: { id }, data: data as never })
  return NextResponse.json(updated)
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const companyId = await resolveCompanyId(new URL(request.url).searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
  const uc = await ensureCompanyAccess(companyId)
  if (uc.role !== "ADMIN") return NextResponse.json({ error: "Only admin can remove member" }, { status: 403 })
  // IDOR koruması: hedef üyelik gerçekten bu firmaya ait olmalı (bkz. PATCH).
  const membership = await prisma.userCompany.findFirst({ where: { id, companyId } })
  if (!membership) return NextResponse.json({ error: "Üye bulunamadı" }, { status: 404 })
  await prisma.userCompany.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
