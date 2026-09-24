import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { normalizeDeviceInput, type OkcDeviceView } from "@/lib/okc/devices"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Yazarkasa (ÖKC) tanımları — ŞUBE bazlı. Plan: docs/okc/ASAMA1-KOBIPO.md A2.
 *
 * OKUMA: yazarkasa ayarı, Z raporu formu (cihaz seçici), fiş detayı ve gün sonu
 * raporu okur. YAZMA yalnız yazarkasa ayarı ekranından — rol ayrımını sayfa
 * kapısı yapar (lib/page-access.ts: writePages ["/ayarlar/yazarkasa"]).
 */
export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    await ensureCompanyAccess(companyId)

    const devices = await prisma.okcDevice.findMany({
      where: { companyId },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: {
        _count: { select: { zReports: true } },
        zReports: { orderBy: { takenAt: "desc" }, take: 1, select: { zNo: true, takenAt: true } },
      },
    })

    const view: OkcDeviceView[] = devices.map((d) => ({
      id: d.id,
      name: d.name,
      brand: d.brand,
      model: d.model,
      serialNo: d.serialNo,
      ekuNo: d.ekuNo,
      provider: d.provider,
      mode: d.mode,
      isActive: d.isActive,
      zReportCount: d._count.zReports,
      lastZ: d.zReports[0] ? { zNo: d.zReports[0].zNo, takenAt: d.zReports[0].takenAt.toISOString() } : null,
    }))

    return NextResponse.json(view)
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error fetching OKC devices:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withApiErrors(async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    await ensureCompanyWrite(companyId)

    const parsed = normalizeDeviceInput(body)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const data = parsed.data as Required<typeof parsed.data>

    const clash = await prisma.okcDevice.findFirst({
      where: { companyId, serialNo: data.serialNo },
      select: { name: true },
    })
    if (clash) {
      return NextResponse.json(
        { error: `Bu seri numarası zaten tanımlı (${clash.name})` },
        { status: 409 },
      )
    }

    const device = await prisma.okcDevice.create({
      data: { companyId, ...data, createdBy: user.id },
    })

    return NextResponse.json(device, { status: 201 })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "Bu seri numarası zaten tanımlı" }, { status: 409 })
    }
    console.error("Error creating OKC device:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
