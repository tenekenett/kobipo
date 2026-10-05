import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { resolveSlugId } from "@/lib/slug-resolve"

export const dynamic = "force-dynamic"

/**
 * Çalışanın takvimi — vardiyalı / sabit mesai / firmanın düzeni (`Employee.usesShifts`)
 * — ve YALNIZ bu alan. Kural: lib/personel/kip.ts; CLAUDE.md "Çalışma düzeni".
 *
 * Vardiya ve devam takvimindeki "çalışma düzeni" penceresi buraya yazar. Eskiden genel
 * kart ucunu (`PUT /api/personel/employees/[id]`) kullanıyordu; o uç maaş, IBAN ve kimlik
 * gibi alanları da yazdığı için yalnız "Personeller" düzenleme yetkisine bağlı ve takvim
 * yetkisiyle oraya yazılamıyordu: hazır "Vardiya Sorumlusu" rolünde pencere 403 alıyordu
 * (2026-10-05, rol taraması). Sayfa kuralı: PAGE_API_RULES →
 * `/api/personel/employees/*\/calisma-duzeni`.
 */
export const PUT = withApiErrors(async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: rawId } = await params
  const id = await resolveSlugId("employee", rawId, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))
  const existing = await prisma.employee.findUnique({ where: { id }, select: { companyId: true } })
  if (!existing) return NextResponse.json({ error: "Employee not found" }, { status: 404 })
  await ensureCompanyWrite(existing.companyId)

  const body = await request.json().catch(() => ({}))
  if (!body || !("usesShifts" in body)) {
    return NextResponse.json({ error: "usesShifts zorunlu (true, false ya da null)" }, { status: 400 })
  }
  // null GEÇERLİ bir değerdir ("firmanın düzenine dön"); genel kart ucuyla aynı çözüm.
  const usesShifts = body.usesShifts === true ? true : body.usesShifts === false ? false : null

  const employee = await prisma.employee.update({
    where: { id },
    data: { usesShifts },
    select: { id: true, usesShifts: true },
  })
  return NextResponse.json(employee)
})
