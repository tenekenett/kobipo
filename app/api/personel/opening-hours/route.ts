import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { normalizeOpeningHours } from "@/lib/personel/opening-hours"

export const dynamic = "force-dynamic"

/**
 * İşletmenin haftalık açılış saati (Company.openingHours).
 *
 * Vardiya takviminin en üst satırı buradan çizilir. Firma ayarı olduğu halde
 * personel altında duruyor: tek tüketicisi vardiya takvimi ve oradan yerinde
 * düzenleniyor — ayrı bir ayar ekranına gitmeden.
 */
export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const companyId = await resolveCompanyId(searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyAccess(companyId)

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { openingHours: true },
  })

  return NextResponse.json({ openingHours: normalizeOpeningHours(company?.openingHours) })
})

export const PUT = withApiErrors(async function PUT(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const companyId = await resolveCompanyId(body.companyId)
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyWrite(companyId)

  // Normalize edilemeyen gövde reddedilir: bozuk JSON sessizce yazılırsa takvim
  // her açılışta "tanımsız" gösterir ve kullanıcı kaydının nereye gittiğini bulamaz.
  const hours = normalizeOpeningHours(body.openingHours)
  if (!hours) return NextResponse.json({ error: "Geçersiz açılış saati tablosu" }, { status: 400 })

  await prisma.company.update({ where: { id: companyId }, data: { openingHours: hours } })
  return NextResponse.json({ openingHours: hours })
})
