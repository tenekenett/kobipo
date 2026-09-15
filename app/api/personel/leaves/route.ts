import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { dayToUtcDate } from "@/lib/personel/vardiya"
import { DAY_RE } from "@/lib/personel/shift-api"
import { assertLeaveAllowed, inclusiveDays, leaveRuleErrorResponse } from "@/lib/personel/izin"

export const dynamic = "force-dynamic"

const VALID_TYPES = ["ANNUAL", "EXCUSE", "SICK", "UNPAID"]

/**
 * İzin listesi.
 *
 * `from`/`to` ARALIĞA DEĞEN izinleri süzer (aralıktan önce başlayıp içine
 * sarkanlar dahil): vardiya takvimi yalnız çizdiği haftayı ister, oysa süzgeç
 * yokken firmanın bütün geçmiş izinleri her takvim açılışında geliyordu — birkaç
 * yıl sonra yüzlerce kayıt. İzin ekranı aralık vermez, tamamını almaya devam eder.
 */
export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const companyId = await resolveCompanyId(searchParams.get("companyId"))
  const status = searchParams.get("status")
  const employeeId = searchParams.get("employeeId")
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  const from = searchParams.get("from")
  const to = searchParams.get("to")
  if ((from && !DAY_RE.test(from)) || (to && !DAY_RE.test(to))) {
    return NextResponse.json({ error: "from/to YYYY-MM-DD olmalı" }, { status: 400 })
  }

  await ensureCompanyAccess(companyId)

  const where: any = { companyId }
  if (status) where.status = status
  if (employeeId) where.employeeId = employeeId
  // Kesişim koşulu: izin aralığın bitişinden önce başlamış VE başlangıcından
  // sonra bitmiş olmalı. İki uç ayrı ayrı verilebilir.
  if (to) where.startDate = { lte: dayToUtcDate(to) }
  if (from) where.endDate = { gte: dayToUtcDate(from) }

  const leaves = await prisma.leaveRecord.findMany({
    where,
    include: { employee: { select: { id: true, firstName: true, lastName: true, department: true } } },
    orderBy: { startDate: "desc" },
  })
  return NextResponse.json(leaves)
})

export const POST = withApiErrors(async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  body.companyId = await resolveCompanyId(body.companyId)
  const { companyId, employeeId, type, startDate, endDate } = body
  if (!companyId || !employeeId || !type || !startDate || !endDate) {
    return NextResponse.json({ error: "companyId, employeeId, type, startDate, endDate zorunlu" }, { status: 400 })
  }
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: "Geçersiz izin türü" }, { status: 400 })
  }
  await ensureCompanyWrite(companyId)

  const employee = await prisma.employee.findFirst({ where: { id: employeeId, companyId } })
  if (!employee) return NextResponse.json({ error: "Personel bulunamadı" }, { status: 404 })

  const start = new Date(startDate)
  const end = new Date(endDate)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return NextResponse.json({ error: "Geçersiz tarih aralığı" }, { status: 400 })
  }
  // Gün sayısı takvimden; istemcinin `days`ı OKUNMAZ (bkz. lib/personel/izin.ts).
  const days = inclusiveDays(start, end)

  // Çakışan izin → 409; yıllık bakiye aşımı → 409 (ekran sorar, `allowOverdraft`
  // ile yeniden gönderir).
  try {
    await assertLeaveAllowed(prisma, {
      companyId,
      employeeId,
      type,
      start,
      end,
      days,
      entitlement: employee.annualLeaveDays,
      allowOverdraft: body.allowOverdraft === true,
    })
  } catch (ruleErr) {
    const res = leaveRuleErrorResponse(ruleErr)
    if (res) return NextResponse.json(res.body, { status: res.status })
    throw ruleErr
  }

  const leave = await prisma.leaveRecord.create({
    data: {
      companyId,
      employeeId,
      type,
      startDate: start,
      endDate: end,
      days,
      reason: body.reason || null,
      createdBy: user.id,
    },
    include: { employee: { select: { id: true, firstName: true, lastName: true, department: true } } },
  })
  return NextResponse.json(leave, { status: 201 })
})
