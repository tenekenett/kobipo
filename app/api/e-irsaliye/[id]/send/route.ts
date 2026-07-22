import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { createEInvoiceProvider } from "@/lib/integrations/e-invoice/factory"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"

export const dynamic = "force-dynamic"

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const waybill = await prisma.waybill.findUnique({
    where: { id },
    include: {
      customer: true,
      supplier: true,
      items: true,
    },
  })
  if (!waybill) return NextResponse.json({ error: "Waybill not found" }, { status: 404 })

  await ensureCompanyWrite(waybill.companyId)
  if (waybill.status !== "DRAFT") {
    return NextResponse.json({ error: "Only draft waybills can be sent" }, { status: 400 })
  }

  try {
    assertEInvoiceRuntimeReady()
    const provider = createEInvoiceProvider()
    const response = await provider.sendInvoice({
      invoiceNo: waybill.waybillNo,
      date: waybill.date,
      dueDate: waybill.deliveryDate || undefined,
      customer: waybill.customer
        ? {
            name: waybill.customer.name,
            taxNumber: waybill.customer.taxNumber || undefined,
            taxOffice: waybill.customer.taxOffice || undefined,
            address: waybill.customer.address || undefined,
            city: waybill.customer.city || undefined,
            country: waybill.customer.country || undefined,
          }
        : undefined,
      supplier: waybill.supplier
        ? {
            name: waybill.supplier.name,
            taxNumber: waybill.supplier.taxNumber || undefined,
            taxOffice: waybill.supplier.taxOffice || undefined,
            address: waybill.supplier.address || undefined,
            city: waybill.supplier.city || undefined,
            country: waybill.supplier.country || undefined,
          }
        : undefined,
      items: waybill.items.map((item) => ({
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: 0,
        vatRate: 0,
      })),
      notes: waybill.notes || undefined,
    })

    if (!response.success || !response.uuid) {
      await prisma.waybill.update({
        where: { id: waybill.id },
        data: { integrationStatus: `ERROR:${response.error || "UNKNOWN"}` },
      })
      return NextResponse.json({ error: response.error || "Send failed" }, { status: 400 })
    }

    const updated = await prisma.waybill.update({
      where: { id: waybill.id },
      data: {
        uuid: response.uuid,
        status: "SENT",
        integrationId: provider.name,
        integrationStatus: "SENT",
        createdBy: user.id,
      },
    })

    return NextResponse.json(updated)
  } catch (error: any) {
    await prisma.waybill.update({
      where: { id: waybill.id },
      data: { integrationStatus: `ERROR:${error.message}` },
    })
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
