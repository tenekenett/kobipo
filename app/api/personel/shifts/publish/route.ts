import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { dayToUtcDate, weekStartIso } from "@/lib/personel/vardiya"
import { DAY_RE } from "@/lib/personel/shift-api"
import { publishWeek } from "@/lib/personel/yayin"

export const dynamic = "force-dynamic"

/** Haftanın yayın durumu — takvim üst çubuğu bunu okur. */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const companyId = await resolveCompanyId(searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  const weekStart = searchParams.get("weekStart")
  if (!weekStart || !DAY_RE.test(weekStart)) {
    return NextResponse.json({ error: "weekStart YYYY-MM-DD olmalı" }, { status: 400 })
  }

  await ensureCompanyAccess(companyId)

  const row = await prisma.shiftPublication.findUnique({
    where: { companyId_weekStart: { companyId, weekStart: dayToUtcDate(weekStart) } },
  })
  if (!row) return NextResponse.json(null)

  return NextResponse.json({
    publishedAt: row.publishedAt.toISOString(),
    notifiedCount: row.notifiedCount,
    shiftCount: row.shiftCount,
  })
}

/**
 * Haftayı yayınlar; `notify` ile personele e-posta gönderir.
 *
 * `weekStart` sunucuda PAZARTESİ'ye normalize edilir: istemci haftanın ortasından
 * bir gün gönderirse iki farklı yayın kaydı oluşur ve hafta hem "yayında" hem
 * "yayında değil" görünürdü.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const companyId = await resolveCompanyId(body.companyId)
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  const raw = String(body.weekStart || "")
  if (!DAY_RE.test(raw)) {
    return NextResponse.json({ error: "weekStart YYYY-MM-DD olmalı" }, { status: 400 })
  }

  await ensureCompanyWrite(companyId)

  const result = await publishWeek({
    companyId,
    weekStart: weekStartIso(raw),
    notify: body.notify === true,
    userId: user.id,
  })
  return NextResponse.json(result)
}
