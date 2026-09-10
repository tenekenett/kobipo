import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { isDevamStatus } from "@/lib/personel/devam"
import { dayToUtcDate, utcDateToDay } from "@/lib/personel/vardiya"
import { DAY_RE } from "@/lib/personel/shift-api"

export const dynamic = "force-dynamic"

/** Tek istekte yazılabilecek en çok hücre — 40 personel × 31 gün civarı. */
const MAX_CELLS = 1500

/**
 * Devam takvimi (tek düze çalışan işletme) — hücre okuma ve yazma.
 *
 * SATIR = İSTİSNA: burada duran her kayıt kullanıcının bilinçli işaretlemesidir.
 * Kayıt YOKKEN gün türetilir (onaylı izin / tatil / kapalı gün / çalıştı — bkz.
 * lib/personel/devam.ts). Bu yüzden "çalıştı"ya geri dönmek de bir yazma değil,
 * SİLME işlemidir: `status: null` gönderilir ve satır kalkar. Aksi halde takvim,
 * sonradan girilen bir iznin üstünü sessizce örten binlerce "çalıştı" satırıyla
 * dolardı.
 */
export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const companyId = await resolveCompanyId(searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  const from = searchParams.get("from")
  const to = searchParams.get("to") || from
  if (!from || !DAY_RE.test(from) || !to || !DAY_RE.test(to)) {
    return NextResponse.json({ error: "from/to YYYY-MM-DD olmalı" }, { status: 400 })
  }

  await ensureCompanyAccess(companyId)

  const employeeId = searchParams.get("employeeId")
  const rows = await prisma.attendanceDay.findMany({
    where: {
      companyId,
      ...(employeeId ? { employeeId } : {}),
      workDate: { gte: dayToUtcDate(from), lte: dayToUtcDate(to) },
    },
    select: {
      id: true,
      employeeId: true,
      workDate: true,
      status: true,
      note: true,
      updatedAt: true,
    },
    orderBy: [{ workDate: "asc" }],
  })

  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      workDate: utcDateToDay(r.workDate),
      status: r.status,
      note: r.note,
      updatedAt: r.updatedAt.toISOString(),
    })),
  )
})

type CellInput = { employeeId: string; workDate: string; status: string | null; note?: string | null }

/**
 * Hücre(ler)i yaz.
 *
 * Tek hücre de toplu doldurma da aynı uçtan geçer: haftalık takvimde "tüm satırı
 * izinli yap" tek jesttir ve her hücre için ayrı istek atmak 7 gidiş-dönüş
 * demekti. Gövde `cells` dizisi taşır; tek tıklamada dizi tek elemanlıdır.
 */
export const POST = withApiErrors(async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const companyId = await resolveCompanyId(body.companyId)
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  const cells: CellInput[] = Array.isArray(body.cells) ? body.cells : []
  if (cells.length === 0) {
    return NextResponse.json({ error: "cells boş olamaz" }, { status: 400 })
  }
  if (cells.length > MAX_CELLS) {
    return NextResponse.json(
      { error: `Tek seferde en çok ${MAX_CELLS} gün işaretlenebilir (${cells.length} istendi)` },
      { status: 400 },
    )
  }
  for (const cell of cells) {
    if (!cell?.employeeId || !DAY_RE.test(String(cell?.workDate))) {
      return NextResponse.json(
        { error: "Her hücrede employeeId ve YYYY-MM-DD biçiminde workDate olmalı" },
        { status: 400 },
      )
    }
    if (cell.status !== null && !isDevamStatus(cell.status)) {
      return NextResponse.json({ error: `Geçersiz durum: ${cell.status}` }, { status: 400 })
    }
  }

  await ensureCompanyWrite(companyId)

  // Personeller bu firmaya mı ait: companyId istemciden geliyor, doğrulanmazsa
  // başka firmanın personeline devam kaydı yazılabilirdi.
  const employeeIds = [...new Set(cells.map((c) => c.employeeId))]
  const owned = await prisma.employee.findMany({
    where: { id: { in: employeeIds }, companyId },
    select: { id: true },
  })
  if (owned.length !== employeeIds.length) {
    return NextResponse.json({ error: "Personel bulunamadı" }, { status: 404 })
  }

  const cleared = cells.filter((c) => c.status === null)
  const written = cells.filter((c) => c.status !== null)

  await prisma.$transaction([
    // "Çalıştı"ya dönüş = satırı sil: olağan hâl türetilir, saklanmaz.
    ...cleared.map((c) =>
      prisma.attendanceDay.deleteMany({
        where: { companyId, employeeId: c.employeeId, workDate: dayToUtcDate(c.workDate) },
      }),
    ),
    ...written.map((c) =>
      prisma.attendanceDay.upsert({
        where: {
          employeeId_workDate: {
            employeeId: c.employeeId,
            workDate: dayToUtcDate(c.workDate),
          },
        },
        create: {
          companyId,
          employeeId: c.employeeId,
          workDate: dayToUtcDate(c.workDate),
          status: c.status as string,
          note: c.note || null,
          createdBy: user.id,
          updatedBy: user.id,
        },
        update: {
          status: c.status as string,
          note: c.note || null,
          updatedBy: user.id,
        },
      }),
    ),
  ])

  return NextResponse.json({ written: written.length, cleared: cleared.length })
})
