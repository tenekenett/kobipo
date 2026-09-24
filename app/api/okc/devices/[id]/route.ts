import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { normalizeDeviceInput } from "@/lib/okc/devices"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/**
 * Cihazı düzenler. EKÜ değişince yalnız cihazdaki GÜNCEL değer değişir; geçmiş
 * Z kayıtları kendi EKÜ kopyasını taşıdığı için etkilenmez.
 */
export const PATCH = withApiErrors(async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    await ensureCompanyWrite(companyId)

    const { id } = await params
    const existing = await prisma.okcDevice.findFirst({ where: { id, companyId }, select: { id: true } })
    if (!existing) return NextResponse.json({ error: "Yazarkasa bulunamadı" }, { status: 404 })

    const parsed = normalizeDeviceInput(body, { partial: true })
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const data: Record<string, unknown> = { ...parsed.data }
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive)

    if (parsed.data.serialNo) {
      const clash = await prisma.okcDevice.findFirst({
        where: { companyId, serialNo: parsed.data.serialNo, id: { not: id } },
        select: { name: true },
      })
      if (clash) {
        return NextResponse.json({ error: `Bu seri numarası zaten tanımlı (${clash.name})` }, { status: 409 })
      }
    }

    const device = await prisma.okcDevice.update({ where: { id }, data })
    return NextResponse.json(device)
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "Bu seri numarası zaten tanımlı" }, { status: 409 })
    }
    console.error("Error updating OKC device:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

/**
 * Yalnız HİÇ izi olmayan cihaz silinir. Z raporu ya da fişi olan cihaz mali
 * kaydın parçasıdır: silinirse "bu Z hangi cihazın" sorusu cevapsız kalırdı.
 * O durumda 409 döner, ekran pasife almayı önerir.
 */
export const DELETE = withApiErrors(async function DELETE(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    await ensureCompanyWrite(companyId)

    const { id } = await params
    const device = await prisma.okcDevice.findFirst({
      where: { id, companyId },
      select: { id: true, _count: { select: { zReports: true, invoices: true } } },
    })
    if (!device) return NextResponse.json({ error: "Yazarkasa bulunamadı" }, { status: 404 })

    if (device._count.zReports > 0 || device._count.invoices > 0) {
      return NextResponse.json(
        {
          error: "Bu yazarkasanın Z raporu ya da fişi var; silinemez. Kullanımdan kaldırmak için pasife alın.",
          code: "HAS_HISTORY",
        },
        { status: 409 },
      )
    }

    await prisma.okcDevice.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error deleting OKC device:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
