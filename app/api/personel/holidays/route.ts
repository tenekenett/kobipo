import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { MAX_MINUTE, dayToUtcDate } from "@/lib/personel/vardiya"
import { DAY_RE } from "@/lib/personel/shift-api"
import { fixedHolidaysForYear, toHolidayDto } from "@/lib/personel/tatil"

export const dynamic = "force-dynamic"

/**
 * İşletme tatilleri (`CompanyHoliday`).
 *
 * Liste YIL süzgeci almaz: tekrar eden tatiller yıl bilgisinden bağımsızdır
 * (yalnız ay+gün eşleşir), yıla göre sorgulansaydı takvimde kaybolurlardı.
 * Süzgeç istemcide, `holidayOn` ile yapılır.
 */
export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const companyId = await resolveCompanyId(searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyAccess(companyId)

  const holidays = await prisma.companyHoliday.findMany({
    where: { companyId },
    orderBy: { date: "asc" },
  })
  return NextResponse.json(holidays.map(toHolidayDto))
})

/**
 * Tatil ekler. `seedYear` verilirse o yılın SABİT TARİHLİ resmî tatilleri toplu
 * eklenir (aynı güne ikinci kayıt açılmaz). Dinî bayramlar kayan tarihli olduğu
 * için bu listede yoktur — işveren elle girer.
 */
export const POST = withApiErrors(async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const companyId = await resolveCompanyId(body.companyId)
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyWrite(companyId)

  if (body.seedYear) {
    const year = Number(body.seedYear)
    if (!Number.isInteger(year)) {
      return NextResponse.json({ error: "seedYear geçersiz" }, { status: 400 })
    }
    const candidates = fixedHolidaysForYear(year)
    const existing = await prisma.companyHoliday.findMany({
      where: { companyId },
      select: { date: true, recurring: true },
    })
    // Tekrar eden kayıt zaten her yılı kapsıyor: yıl farklı olsa da ay+gün
    // tutuyorsa yeniden eklenmez, yoksa her yıl aynı tatil çoğalırdı.
    const taken = new Set(
      existing.map((e) => {
        const iso = e.date.toISOString().slice(0, 10)
        return e.recurring ? iso.slice(5) : iso
      }),
    )
    const toCreate = candidates.filter(
      (c) => !taken.has(c.date.slice(5)) && !taken.has(c.date),
    )
    if (toCreate.length === 0) {
      return NextResponse.json({ created: 0, message: "Resmî tatiller zaten ekli" })
    }
    await prisma.companyHoliday.createMany({
      data: toCreate.map((c) => ({
        companyId,
        name: c.name,
        date: dayToUtcDate(c.date),
        recurring: c.recurring,
        halfDayFrom: c.halfDayFrom,
        createdBy: user.id,
      })),
    })
    return NextResponse.json({ created: toCreate.length })
  }

  const name = String(body.name || "").trim()
  const date = String(body.date || "")
  if (!name) return NextResponse.json({ error: "Tatil adı zorunlu" }, { status: 400 })
  if (!DAY_RE.test(date)) return NextResponse.json({ error: "Tarih YYYY-MM-DD olmalı" }, { status: 400 })

  const halfDayFrom =
    body.halfDayFrom == null || body.halfDayFrom === ""
      ? null
      : Math.round(Number(body.halfDayFrom))
  if (halfDayFrom != null && (!Number.isFinite(halfDayFrom) || halfDayFrom < 0 || halfDayFrom > MAX_MINUTE)) {
    return NextResponse.json({ error: "Yarım gün saati geçersiz" }, { status: 400 })
  }

  const created = await prisma.companyHoliday.create({
    data: {
      companyId,
      name,
      date: dayToUtcDate(date),
      recurring: body.recurring === true,
      halfDayFrom,
      createdBy: user.id,
    },
  })
  return NextResponse.json(toHolidayDto(created), { status: 201 })
})
