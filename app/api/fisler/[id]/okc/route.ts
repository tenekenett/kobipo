import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { normalizeReceiptOkcInput } from "@/lib/okc/receipt-okc"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/**
 * Satış fişinin ÖKC kimliğini (yazarkasa, ÖKC fiş no, Z no) elle yazar/temizler.
 * Plan: docs/okc/ASAMA1-KOBIPO.md A3 (K2 — isteğe bağlı).
 *
 * Cihazdan gelen kimlik (okcSource = DEVICE, Aşama 2) elle değiştirilemez.
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
    const receipt = await prisma.invoice.findFirst({
      where: { id, companyId },
      select: { id: true, isReceipt: true, type: true, status: true, okcSource: true },
    })
    if (!receipt) return NextResponse.json({ error: "Fiş bulunamadı" }, { status: 404 })
    if (!receipt.isReceipt || receipt.type !== "SALES") {
      return NextResponse.json({ error: "ÖKC bilgisi yalnız satış fişine girilir" }, { status: 400 })
    }
    if (receipt.status === "CANCELLED") {
      return NextResponse.json({ error: "İptal edilmiş fişe ÖKC bilgisi girilemez" }, { status: 400 })
    }
    if (receipt.okcSource === "DEVICE") {
      return NextResponse.json(
        { error: "Bu fişin ÖKC bilgisi yazarkasadan geldi; elle değiştirilemez" },
        { status: 409 },
      )
    }

    const parsed = normalizeReceiptOkcInput(body)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const data = parsed.data

    if (data.okcDeviceId) {
      const device = await prisma.okcDevice.findFirst({
        where: { id: data.okcDeviceId, companyId },
        select: { id: true },
      })
      if (!device) return NextResponse.json({ error: "Yazarkasa bulunamadı" }, { status: 404 })
    }

    const cleared = !data.okcDeviceId && data.okcReceiptNo === null && data.okcZNo === null
    const updated = await prisma.invoice.update({
      where: { id },
      data: { ...data, okcSource: cleared ? null : "USER" },
      select: {
        okcDeviceId: true,
        okcReceiptNo: true,
        okcZNo: true,
        okcSource: true,
        okcDevice: { select: { name: true } },
      },
    })

    return NextResponse.json({
      deviceId: updated.okcDeviceId,
      deviceName: updated.okcDevice?.name ?? null,
      receiptNo: updated.okcReceiptNo,
      zNo: updated.okcZNo,
      source: updated.okcSource,
    })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error updating receipt OKC identity:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
