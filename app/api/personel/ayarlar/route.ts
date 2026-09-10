import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { isWorkScheduleMode, normalizeMode } from "@/lib/personel/kip"

export const dynamic = "force-dynamic"

/**
 * Personel modülü firma ayarı — çalışma düzeni.
 *
 * DÖRT DURUM: `null` "henüz sorulmadı" demektir ve modülün ilk açılışında kurulum
 * penceresini çıkarır; `SHIFT` vardiya takvimini, `FLAT` devam takvimini, `MIXED`
 * ikisini birden menüde tutar. "Henüz sorulmadı" ile "sabit mesai" ayrı tutulmasa
 * soru hiç sorulamazdı.
 *
 * KARMA işletmede kimin hangi takvimde olduğu BU ayarla belirlenmez; o karar
 * personel kartındadır (`Employee.usesShifts`, bkz. lib/personel/kip.ts). Burası
 * yalnız hangi ekranların var olduğunu söyler.
 *
 * Ayar FİRMA bazındadır (hesap değil): aynı hesabın kafesi vardiyalı, ofisi tek
 * düze çalışabilir. Bu yüzden şubeye/ek firmaya devredilmez.
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
    select: { workScheduleMode: true },
  })

  return NextResponse.json({ workScheduleMode: normalizeMode(company?.workScheduleMode) })
})

export const PUT = withApiErrors(async function PUT(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const companyId = await resolveCompanyId(body.companyId)
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  // `null` da geçerli bir değerdir: "kararı sonra vereyim" demek soruyu geri
  // getirir. Bu yüzden undefined ile null AYRI ele alınır.
  const raw = body.workScheduleMode
  if (raw !== null && !isWorkScheduleMode(raw)) {
    return NextResponse.json(
      { error: "workScheduleMode SHIFT, FLAT, MIXED veya null olmalı" },
      { status: 400 },
    )
  }

  await ensureCompanyWrite(companyId)

  const company = await prisma.company.update({
    where: { id: companyId },
    data: { workScheduleMode: raw },
    select: { workScheduleMode: true },
  })

  return NextResponse.json({ workScheduleMode: normalizeMode(company.workScheduleMode) })
})
