import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { randomBytes } from "crypto"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveBaseUrl } from "@/lib/utils/base-url"
import { canManageCompany } from "@/lib/auth/branch-access"
import { sendEmail } from "@/lib/email/resend"
import {
  branchManagerInviteEmail,
  branchManagerAssignedEmail,
} from "@/lib/email/templates"

export const dynamic = "force-dynamic"

/**
 * Şube müdürü yönetimi.
 *
 * Yönetilebilir birimler = kullanıcının ADMIN olduğu firmalar + bu firmaların
 * alt şubeleri. Her birime BRANCH_MANAGER rolünde bir kullanıcı atanabilir/kaldırılabilir.
 *
 * Yetki: bir firmaya/şubeye müdür atayabilmek için kullanıcı ya o firmanın DOĞRUDAN
 * ADMIN'i, ya (şube ise) ana firmasının, ya da (hesaba bağlı ek firmaysa) hesap kökünün
 * ADMIN'i olmalıdır (bkz. canManageCompany).
 */

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Kullanıcının ADMIN olduğu firmalar.
  const adminMemberships = await prisma.userCompany.findMany({
    where: { userId: user.id, role: "ADMIN" },
    select: { companyId: true },
  })
  const adminCompanyIds = adminMemberships.map((m) => m.companyId)

  // Yönetilebilir birimler: bu firmalar + alt şubeleri + ADMIN olunan hesabın üyeleri
  // (ek firmalar ve onların şubeleri). Kapsam canManageCompany ile aynı olmalı, aksi
  // halde listede görünmeyen ama atama yapılabilen (ya da tersi) birim oluşur.
  const units = await prisma.company.findMany({
    where: {
      OR: [
        { id: { in: adminCompanyIds } },
        { parentCompanyId: { in: adminCompanyIds } },
        { accountRootId: { in: adminCompanyIds } },
      ],
    },
    select: {
      id: true,
      name: true,
      branchName: true,
      parentCompanyId: true,
      accountRootId: true,
    },
    orderBy: { name: "asc" },
  })
  const unitIds = units.map((u) => u.id)
  const nameById = new Map(units.map((u) => [u.id, u.name]))

  const [managers, invitations] = await Promise.all([
    prisma.userCompany.findMany({
      where: { companyId: { in: unitIds }, role: "BRANCH_MANAGER" },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.companyInvitation.findMany({
      where: {
        companyId: { in: unitIds },
        role: "BRANCH_MANAGER",
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    }),
  ])

  // Ana firma önce, hemen altında kendi şubeleri (ada göre) gelecek şekilde grupla.
  const groupName = (u: (typeof units)[number]) =>
    nameById.get(u.parentCompanyId ?? u.id) ?? u.name
  const sorted = [...units].sort((a, b) => {
    const g = groupName(a).localeCompare(groupName(b), "tr")
    if (g !== 0) return g
    const ab = a.parentCompanyId ? 1 : 0
    const bb = b.parentCompanyId ? 1 : 0
    if (ab !== bb) return ab - bb
    return a.name.localeCompare(b.name, "tr")
  })

  const result = sorted.map((u) => ({
    id: u.id,
    name: u.name,
    // Ana firma ve şubeleri aynı ünvanı taşıyabilir; listede ayırt eden ad budur.
    branchName: u.branchName ?? null,
    isBranch: Boolean(u.parentCompanyId),
    parentName: u.parentCompanyId ? nameById.get(u.parentCompanyId) ?? null : null,
    managers: managers
      .filter((m) => m.companyId === u.id)
      .map((m) => ({
        membershipId: m.id,
        userId: m.userId,
        name: m.user?.name ?? null,
        email: m.user?.email ?? "",
      })),
    invitations: invitations
      .filter((i) => i.companyId === u.id)
      .map((i) => ({ id: i.id, email: i.email, createdAt: i.createdAt })),
  }))

  return NextResponse.json({ branches: result })
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { companyId: __cidRaw, email } = await request.json()
  const companyId = await resolveCompanyId(__cidRaw)
  if (!companyId || !email) {
    return NextResponse.json({ error: "companyId ve email zorunludur" }, { status: 400 })
  }

  const company = await canManageCompany(user.id, companyId)
  if (!company) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 })
  }

  const parentName = company.parentCompanyId
    ? (
        await prisma.company.findUnique({
          where: { id: company.parentCompanyId },
          select: { name: true },
        })
      )?.name ?? null
    : null

  const baseUrl = resolveBaseUrl(request)
  const normalizedEmail = String(email).trim().toLowerCase()
  const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } })

  if (existingUser) {
    // Mevcut ADMIN'i şube müdürüne DÜŞÜRME. Aksi halde upsert rolü ezerdi.
    const existingMembership = await prisma.userCompany.findUnique({
      where: { userId_companyId: { userId: existingUser.id, companyId: company.id } },
      select: { role: true },
    })
    if (existingMembership?.role === "ADMIN") {
      return NextResponse.json(
        { error: "Bu kullanıcı zaten bu firmanın yöneticisi." },
        { status: 400 }
      )
    }

    await prisma.userCompany.upsert({
      where: { userId_companyId: { userId: existingUser.id, companyId: company.id } },
      update: { role: "BRANCH_MANAGER", invitedBy: user.id, invitedAt: new Date() },
      create: {
        userId: existingUser.id,
        companyId: company.id,
        role: "BRANCH_MANAGER",
        invitedBy: user.id,
        invitedAt: new Date(),
      },
    })

    // Bildirim e-postası yan işlemdir; başarısız olsa da atama tamamlanmış sayılır.
    const { subject, html } = branchManagerAssignedEmail({
      appUrl: baseUrl,
      branchName: company.name,
    })
    await sendEmail({ to: normalizedEmail, subject, html })

    return NextResponse.json(
      { status: "added", message: "Kullanıcı şube müdürü olarak atandı" },
      { status: 201 }
    )
  }

  const token = randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  await prisma.companyInvitation.create({
    data: {
      companyId: company.id,
      email: normalizedEmail,
      role: "BRANCH_MANAGER",
      token,
      invitedBy: user.id,
      expiresAt,
    },
  })

  const inviteUrl = `${baseUrl}/invite/${token}`

  // Davet e-postası yan işlemdir; gönderim başarısızsa da davet kaydı durur ve
  // inviteUrl response'ta döndüğü için UI "bağlantıyı kopyala" yedeğini sunabilir.
  const { subject, html } = branchManagerInviteEmail({
    inviteUrl,
    branchName: company.name,
    parentName,
  })
  await sendEmail({ to: normalizedEmail, subject, html })

  return NextResponse.json({ status: "invited", inviteUrl }, { status: 201 })
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(request.url)
  const membershipId = url.searchParams.get("membershipId")
  const invitationId = url.searchParams.get("invitationId")
  if (!membershipId && !invitationId) {
    return NextResponse.json(
      { error: "membershipId veya invitationId zorunludur" },
      { status: 400 }
    )
  }

  // Bekleyen davetiyenin iptali.
  if (invitationId) {
    const invitation = await prisma.companyInvitation.findUnique({
      where: { id: invitationId },
      select: { id: true, companyId: true },
    })
    if (!invitation) {
      return NextResponse.json({ error: "Davet bulunamadı" }, { status: 404 })
    }
    if (!(await canManageCompany(user.id, invitation.companyId))) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    await prisma.companyInvitation.delete({ where: { id: invitation.id } })
    return NextResponse.json({ ok: true })
  }

  const membership = await prisma.userCompany.findUnique({
    where: { id: membershipId! },
    select: { id: true, companyId: true, role: true },
  })
  if (!membership) {
    return NextResponse.json({ error: "Kayıt bulunamadı" }, { status: 404 })
  }
  if (membership.role !== "BRANCH_MANAGER") {
    return NextResponse.json(
      { error: "Yalnızca şube müdürü ataması kaldırılabilir" },
      { status: 400 }
    )
  }
  if (!(await canManageCompany(user.id, membership.companyId))) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 })
  }

  await prisma.userCompany.delete({ where: { id: membership.id } })
  return NextResponse.json({ ok: true })
}
