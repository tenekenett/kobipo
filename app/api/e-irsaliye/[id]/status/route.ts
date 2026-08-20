import { accessDeniedResponse, isAccessDeniedError, withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { createEInvoiceProvider } from "@/lib/integrations/e-invoice/factory"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"

export const dynamic = "force-dynamic"

export const POST = withApiErrors(async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const waybill = await prisma.waybill.findUnique({ where: { id } })
  if (!waybill) return NextResponse.json({ error: "Waybill not found" }, { status: 404 })
  await ensureCompanyWrite(waybill.companyId)

  if (!waybill.uuid) {
    return NextResponse.json({ error: "Waybill has no integration uuid" }, { status: 400 })
  }

  try {
    assertEInvoiceRuntimeReady()
    const provider = createEInvoiceProvider()
    const result = await provider.getInvoiceStatus(waybill.uuid)

    const mappedStatus = result.status === "REJECTED" ? "CANCELLED" : waybill.status
    const updated = await prisma.waybill.update({
      where: { id: waybill.id },
      data: {
        status: mappedStatus,
        integrationStatus: result.status,
      },
    })

    return NextResponse.json({ waybill: updated, providerStatus: result })
  } catch (error: any) {
    // Kapı reddi (modül/sayfa/rol) 403 döner; buradaki diğer dallar veri hatası içindir.
    if (isAccessDeniedError(error)) return accessDeniedResponse(error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
})
