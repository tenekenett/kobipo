import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { sanitizePagePermissions } from "@/lib/page-access"

export const dynamic = "force-dynamic"

export const PATCH = withApiErrors(async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  //
  // ÖNCE "bu üye özel rolde mi KALIYOR" sorulur. `data.customRoleId == null` demek
  // YETMİYORDU: alanı hiç GÖNDERMEYEN bir istek (kişisel izin kaydı böyle) ile "özel
  // rolü kaldır" (açıkça null) aynı sayılıyordu. Sonuç, özel rollü bir üyede sessiz
  // veri kaybıydı: dal çalışıyor, `sanitizePagePermissions` role "CUSTOM" ile ama
  // `custom` bayrağı OLMADAN çağrılıyor, tavan `pagesForRole("CUSTOM")` = BOŞ KÜME
  // çıkıyor ve gönderilen liste tamamen elenip üyeliğe [] yazılıyordu — üstelik yetki
  // zaten rolden geldiği için ekranda hiçbir şey değişmiyordu.
  const keepsCustomRole =
    customRoleId === undefined ? membership.customRoleId != null : data.customRoleId != null
  if (keepsCustomRole && (allowedPaths !== undefined || writablePaths !== undefined)) {
    // Sessizce yutmak yerine SÖYLE: özel rolde yetki rolün kendisindedir
    // (bkz. lib/auth/user-context.ts → customRole?.allowedPaths ?? allowedPaths).
    // Kişisel liste yazılsaydı hiçbir etkisi olmayacaktı; çağıran bunu bilmeli.
    return NextResponse.json(
      {
        error:
          "Bu üyenin yetkisi özel rolünden geliyor; kişiye özel izin listesi uygulanmaz. " +
          "Yetkiyi Ayarlar → Rol Yetkileri ekranından rolün kendisinde düzenleyin.",
      },
      { status: 400 },
    )
  }
  if (!keepsCustomRole && (allowedPaths !== undefined || writablePaths !== undefined)) {
    // Rol de aynı istekte değişiyor olabilir; kesişim YENİ role göre alınmalı.
    const effectiveRole = (role as string | undefined) ?? membership.role
    const sanitized = sanitizePagePermissions(effectiveRole, allowedPaths, writablePaths, {
      // Özel rolü kaldırılan ama enum'u hâlâ CUSTOM olan ara hâlde tavan boş kümeye
      // düşmesin; `ceilingPages` bu bayrakla yönetim-dışı tüm sayfaları verir.
      custom: effectiveRole === "CUSTOM",
    })
    data.allowedPaths = sanitized.allowedPaths
    data.writablePaths = sanitized.writablePaths
  }

  const updated = await prisma.userCompany.update({ where: { id }, data: data as never })
  return NextResponse.json(updated)
})

export const DELETE = withApiErrors(async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
})
