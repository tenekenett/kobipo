import { accessDeniedResponse, isAccessDeniedError, withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { isValidTcKimlik } from "@/lib/personel/validation"
import { resolveSlugId } from "@/lib/slug-resolve"

export const dynamic = "force-dynamic"

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function dateOrNull(v: unknown): Date | null {
  if (!v) return null
  const d = new Date(v as string)
  return Number.isNaN(d.getTime()) ? null : d
}

export const GET = withApiErrors(async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: rawId } = await params
  const id = await resolveSlugId("employee", rawId, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))
  const employee = await prisma.employee.findUnique({
    where: { id },
    include: {
      payrolls: { orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }], take: 12 },
      leaves: { orderBy: { startDate: "desc" }, take: 20 },
      assets: { orderBy: { assignedDate: "desc" } },
      documents: { orderBy: { createdAt: "desc" } },
      // Bağlı Kobipo hesabı (varsa). Şifre/2FA alanları ASLA seçilmez.
      user: { select: { id: true, name: true, email: true } },
    },
  })
  if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 })

  await ensureCompanyAccess(employee.companyId)
  return NextResponse.json(employee)
})

export const PUT = withApiErrors(async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: rawId } = await params
  const id = await resolveSlugId("employee", rawId, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))
  const existing = await prisma.employee.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Employee not found" }, { status: 404 })
  await ensureCompanyWrite(existing.companyId)

  const body = await request.json()
  if (body.nationalId !== undefined && body.nationalId && String(body.nationalId).trim() && !isValidTcKimlik(body.nationalId)) {
    return NextResponse.json({ error: "Geçersiz T.C. Kimlik No" }, { status: 400 })
  }
  const data: any = {}
  const strFields = ["firstName", "lastName", "nationalId", "email", "phone", "department", "position", "iban", "address", "emergencyContact", "notes"]
  for (const f of strFields) {
    if (body[f] !== undefined) data[f] = body[f] || null
  }
  if (body.firstName !== undefined) data.firstName = String(body.firstName).trim()
  if (body.lastName !== undefined) data.lastName = String(body.lastName).trim()
  if (body.birthDate !== undefined) data.birthDate = dateOrNull(body.birthDate)
  if (body.hireDate !== undefined) data.hireDate = dateOrNull(body.hireDate)
  if (body.terminationDate !== undefined) data.terminationDate = dateOrNull(body.terminationDate)
  if (body.grossSalary !== undefined) data.grossSalary = numOrNull(body.grossSalary)
  if (body.annualLeaveDays !== undefined) data.annualLeaveDays = numOrNull(body.annualLeaveDays) ?? existing.annualLeaveDays
  // Kobipo hesabı bağı. Yalnız BU firmanın ekip üyesi bağlanabilir — aksi halde
  // yabancı bir kullanıcı id'si personel kartına iliştirilebilir ve vardiya/ikram
  // kayıtları var olmayan bir üyeliğe işaret ederdi. null = bağı kaldır.
  if (body.userId !== undefined) {
    if (body.userId === null || body.userId === "") {
      data.userId = null
    } else {
      const member = await prisma.userCompany.findFirst({
        where: { userId: String(body.userId), companyId: existing.companyId },
        select: { id: true },
      })
      if (!member) {
        return NextResponse.json(
          { error: "Bu kullanıcı firmanın ekibinde değil. Önce Ekip Yönetimi'nden ekleyin." },
          { status: 400 }
        )
      }
      data.userId = String(body.userId)
    }
  }

  if (body.status !== undefined && ["ACTIVE", "ON_LEAVE", "TERMINATED"].includes(body.status)) {
    data.status = body.status
    // İşten çıkış işaretlenince çıkış tarihini otomatik doldur (yoksa).
    if (body.status === "TERMINATED" && !existing.terminationDate && body.terminationDate === undefined) {
      data.terminationDate = new Date()
    }
  }

  try {
    const employee = await prisma.employee.update({ where: { id }, data })
    return NextResponse.json(employee)
  } catch (error) {
    // Kapı reddi (modül/sayfa/rol) 403 döner; buradaki diğer dallar veri hatası içindir.
    if (isAccessDeniedError(error)) return accessDeniedResponse(error)
    // (companyId, userId) benzersiz: bir hesap aynı firmada iki personel kartına
    // bağlanamaz. Prisma'nın P2002'si kullanıcıya "bilinmeyen hata" olarak düşmesin.
    if (
      error &&
      typeof error === "object" &&
      (error as { code?: string }).code === "P2002" &&
      data.userId
    ) {
      return NextResponse.json(
        { error: "Bu Kobipo hesabı zaten başka bir personel kartına bağlı." },
        { status: 409 }
      )
    }
    throw error
  }
})

export const DELETE = withApiErrors(async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: rawId } = await params
  const id = await resolveSlugId("employee", rawId, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))
  const existing = await prisma.employee.findUnique({
    where: { id },
    include: { _count: { select: { payrolls: true } } },
  })
  if (!existing) return NextResponse.json({ error: "Employee not found" }, { status: 404 })
  await ensureCompanyWrite(existing.companyId)

  // Bordro kaydı olan personel silinmez (mali geçmiş korunur) → işten çıkar.
  if (existing._count.payrolls > 0) {
    return NextResponse.json(
      { error: "Bordro kaydı olan personel silinemez. Bunun yerine 'İşten Çıkar' kullanın." },
      { status: 409 },
    )
  }

  await prisma.employee.delete({ where: { id } })
  return NextResponse.json({ message: "Employee deleted" })
})
