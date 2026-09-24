import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { normalizeZInput, parseStoredPaymentLines, parseStoredVatLines } from "@/lib/okc/z-report"
import { loadZMutabakat } from "@/lib/okc/z-mutabakat-query"
import { canEditZReports } from "@/lib/okc/access"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

const EDIT_DENIED = "Z raporunu yalnız yönetici, şube müdürü ya da muhasebeci düzeltebilir"

/** Z raporu + tam mutabakat (eksen satırları, pencere, fiş listesi). */
export const GET = withApiErrors(async function GET(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    const context = await ensureCompanyAccess(companyId)

    const { id } = await params
    const z = await prisma.okcZReport.findFirst({
      where: { id, companyId },
      include: { device: { select: { id: true, name: true, serialNo: true, brand: true, model: true } } },
    })
    if (!z) return NextResponse.json({ error: "Z raporu bulunamadı" }, { status: 404 })

    return NextResponse.json({
      id: z.id,
      device: z.device,
      zNo: z.zNo,
      takenAt: z.takenAt.toISOString(),
      ekuNo: z.ekuNo,
      grossTotal: Number(z.grossTotal),
      receiptCount: z.receiptCount,
      vatLines: parseStoredVatLines(z.vatLines),
      paymentLines: parseStoredPaymentLines(z.paymentLines),
      cancelCount: z.cancelCount,
      cancelTotal: z.cancelTotal == null ? null : Number(z.cancelTotal),
      source: z.source,
      note: z.note,
      canEdit: canEditZReports(context.role),
      ...(await loadZMutabakat(z)),
    })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error fetching Z report:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

/** Tam değiştirme (form tüm alanları gönderir). Yalnız düzeltme yetkili roller. */
export const PATCH = withApiErrors(async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    const context = await ensureCompanyWrite(companyId)
    if (!canEditZReports(context.role)) return NextResponse.json({ error: EDIT_DENIED }, { status: 403 })

    const { id } = await params
    const existing = await prisma.okcZReport.findFirst({ where: { id, companyId }, select: { id: true } })
    if (!existing) return NextResponse.json({ error: "Z raporu bulunamadı" }, { status: 404 })

    const parsed = normalizeZInput(body)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const data = parsed.data

    const device = await prisma.okcDevice.findFirst({
      where: { id: data.deviceId, companyId },
      select: { id: true, name: true },
    })
    if (!device) return NextResponse.json({ error: "Yazarkasa bulunamadı" }, { status: 404 })

    const clash = await prisma.okcZReport.findFirst({
      where: { deviceId: device.id, zNo: data.zNo, id: { not: id } },
      select: { id: true },
    })
    if (clash) {
      return NextResponse.json({ error: `${device.name} için Z ${data.zNo} zaten girilmiş` }, { status: 409 })
    }

    const z = await prisma.okcZReport.update({
      where: { id },
      data: {
        deviceId: device.id,
        zNo: data.zNo,
        takenAt: data.takenAt,
        ekuNo: data.ekuNo,
        receiptCount: data.receiptCount,
        grossTotal: data.grossTotal,
        vatLines: data.vatLines,
        paymentLines: data.paymentLines,
        cancelCount: data.cancelCount,
        cancelTotal: data.cancelTotal,
        note: data.note,
        updatedBy: user.id,
      },
    })

    return NextResponse.json({ id: z.id, ...(await loadZMutabakat(z)) })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "Bu Z numarası bu cihaz için zaten girilmiş" }, { status: 409 })
    }
    console.error("Error updating Z report:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withApiErrors(async function DELETE(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    const context = await ensureCompanyWrite(companyId)
    if (!canEditZReports(context.role)) return NextResponse.json({ error: EDIT_DENIED }, { status: 403 })

    const { id } = await params
    const result = await prisma.okcZReport.deleteMany({ where: { id, companyId } })
    if (result.count === 0) return NextResponse.json({ error: "Z raporu bulunamadı" }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error deleting Z report:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
