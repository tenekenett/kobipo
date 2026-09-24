import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { normalizeZInput } from "@/lib/okc/z-report"
import { loadZMutabakat } from "@/lib/okc/z-mutabakat-query"
import { canEditZReports } from "@/lib/okc/access"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/** Liste varsayılanı: son 31 gün. Her Z için mutabakat hesaplanır (Z başına 3 sorgu). */
const DEFAULT_DAYS = 31
const MAX_DAYS = 92

function parseDay(value: string | null): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Z raporları + her birinin özet mutabakatı. Plan: docs/okc/ASAMA1-KOBIPO.md A3.
 * Query: companyId, from, to (ISO), deviceId (ops.)
 */
export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    const context = await ensureCompanyAccess(companyId)

    const to = parseDay(searchParams.get("to")) ?? new Date()
    let from = parseDay(searchParams.get("from")) ?? new Date(to.getTime() - DEFAULT_DAYS * 86_400_000)
    if (to.getTime() - from.getTime() > MAX_DAYS * 86_400_000) {
      from = new Date(to.getTime() - MAX_DAYS * 86_400_000)
    }
    const deviceId = searchParams.get("deviceId") || undefined

    const reports = await prisma.okcZReport.findMany({
      where: { companyId, takenAt: { gte: from, lte: to }, ...(deviceId ? { deviceId } : {}) },
      orderBy: { takenAt: "desc" },
      include: { device: { select: { id: true, name: true, serialNo: true } } },
    })

    const rows = await Promise.all(
      reports.map(async (z) => {
        const result = await loadZMutabakat(z)
        return {
          id: z.id,
          device: z.device,
          zNo: z.zNo,
          takenAt: z.takenAt.toISOString(),
          ekuNo: z.ekuNo,
          grossTotal: Number(z.grossTotal),
          receiptCount: z.receiptCount,
          source: z.source,
          kobipoTotal: result.mutabakat.total.kobipo,
          kobipoReceiptCount: result.mutabakat.receiptCount.kobipo,
          totalDiff: result.mutabakat.total.diff,
          ok: result.mutabakat.ok,
          comparable: result.comparable,
          internalIssueCount: result.internalIssues.length,
          firstWindow: result.window.first,
        }
      }),
    )

    return NextResponse.json({
      from: from.toISOString(),
      to: to.toISOString(),
      canEdit: canEditZReports(context.role),
      reports: rows,
    })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error fetching Z reports:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

/**
 * Z raporu girer. Kasiyer de girebilir (sayfa kapısı); düzeltme/silme [id] ucunda
 * rol kuralına tabidir (lib/okc/access.ts).
 */
export const POST = withApiErrors(async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    await ensureCompanyWrite(companyId)

    const parsed = normalizeZInput(body)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const data = parsed.data

    const device = await prisma.okcDevice.findFirst({
      where: { id: data.deviceId, companyId },
      select: { id: true, isActive: true, ekuNo: true, name: true },
    })
    if (!device) return NextResponse.json({ error: "Yazarkasa bulunamadı" }, { status: 404 })
    if (!device.isActive) {
      return NextResponse.json({ error: `${device.name} pasif; Z raporu girilemez` }, { status: 400 })
    }

    const clash = await prisma.okcZReport.findFirst({
      where: { deviceId: device.id, zNo: data.zNo },
      select: { id: true },
    })
    if (clash) {
      return NextResponse.json(
        { error: `${device.name} için Z ${data.zNo} zaten girilmiş`, existingId: clash.id },
        { status: 409 },
      )
    }

    const z = await prisma.okcZReport.create({
      data: {
        companyId,
        deviceId: device.id,
        zNo: data.zNo,
        takenAt: data.takenAt,
        // Boş bırakılırsa cihazdaki güncel EKÜ yazılır (Z fişinde de o yazar).
        ekuNo: data.ekuNo ?? device.ekuNo,
        receiptCount: data.receiptCount,
        grossTotal: data.grossTotal,
        vatLines: data.vatLines,
        paymentLines: data.paymentLines,
        cancelCount: data.cancelCount,
        cancelTotal: data.cancelTotal,
        note: data.note,
        source: "MANUAL",
        createdBy: user.id,
      },
    })

    return NextResponse.json({ id: z.id, ...(await loadZMutabakat(z)) }, { status: 201 })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "Bu Z numarası bu cihaz için zaten girilmiş" }, { status: 409 })
    }
    console.error("Error creating Z report:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
