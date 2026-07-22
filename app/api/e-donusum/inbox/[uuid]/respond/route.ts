import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import {
  resolveCompanyEInvoiceProvider,
  COMPANY_PROVIDER_SELECT,
} from "@/lib/integrations/e-invoice/company-provider"
import { voidInvoice } from "@/lib/integrations/e-invoice/void-invoice"

export const dynamic = "force-dynamic"

/**
 * Gelen TİCARİ (TICARIFATURA) faturaya KABUL / RED yanıtı gönderir.
 *
 * Path: POST /api/e-donusum/inbox/{ettn}/respond
 * Body: { companyId: string, action: "accept" | "reject", rejectReason?: string }
 *
 * Sadece profili TICARIFATURA olan ve henüz yanıtlanmamış (KABUL/RED değil)
 * faturalar yanıtlanabilir — temel fatura ve e-arşiv yanıt beklemez.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ uuid: string }> },
) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { uuid } = await params
    if (!uuid) {
      return NextResponse.json({ error: "uuid (ETTN) zorunlu" }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    // companyId dashboard'dan slug gelebilir → cuid'e çevir. [[resolve-company.ts]]
    const companyId = await resolveCompanyId(body?.companyId)
    const action: string = body?.action
    const rejectReason: string = typeof body?.rejectReason === "string" ? body.rejectReason.trim() : ""

    if (!companyId) {
      return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    }
    if (action !== "accept" && action !== "reject") {
      return NextResponse.json({ error: "Geçersiz işlem (accept | reject)" }, { status: 400 })
    }
    if (action === "reject" && rejectReason.length < 3) {
      return NextResponse.json({ error: "Red nedeni en az 3 karakter olmalı." }, { status: 400 })
    }

    await ensureCompanyWrite(companyId)

    const record = await prisma.incomingInvoice.findUnique({
      where: { companyId_uuid: { companyId, uuid } },
    })
    if (!record) {
      return NextResponse.json({ error: "Kayıt bulunamadı" }, { status: 404 })
    }

    // Yalnızca ticari fatura yanıtlanabilir.
    if (record.profile !== "TICARIFATURA") {
      return NextResponse.json(
        { error: "Sadece ticari (TICARIFATURA) faturalar kabul/ret edilebilir." },
        { status: 400 },
      )
    }
    // Zaten yanıtlanmışsa tekrar yanıtlama.
    const currentStatus = (record.status || "").toUpperCase()
    if (currentStatus === "KABUL" || currentStatus === "RED") {
      return NextResponse.json(
        { error: `Bu fatura zaten yanıtlanmış (${record.status}).` },
        { status: 400 },
      )
    }

    assertEInvoiceRuntimeReady()

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: COMPANY_PROVIDER_SELECT,
    })
    const resolved = resolveCompanyEInvoiceProvider(company)
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    }
    const provider = resolved.provider

    const result =
      action === "accept"
        ? await provider.acceptIncomingInvoice(uuid)
        : await provider.rejectIncomingInvoice(uuid, rejectReason)

    if (!result.success) {
      return NextResponse.json({ error: result.error || "İşlem başarısız." }, { status: 502 })
    }

    // Başarılıysa yerel durumu güncelle (bir sonraki sync zaten doğrular).
    if (action === "reject") {
      // Gelen fatura reddedildiğinde, daha önce bir alış faturasına dönüştürülmüşse
      // (borç oluşturmuşsa) o faturayı da geçersiz kıl: stoğu geri al + status=CANCELLED.
      // Böylece borç tedarikçi carisinden otomatik düşer (cari/rapor sorguları CANCELLED'ı
      // hariç tutar) ve önizlemede "İptal" yerine "Reddedildi" rozeti çıkar
      // (integrationStatus=REJECTED:RED → parseGibStatus bucket "rejected").
      // Giden fatura RED deseninin aynasıdır — bkz. invoices/[id]/check-status/route.ts.
      const linkedInvoice =
        record.isLinkedToPurchase && record.linkedInvoiceId
          ? await prisma.invoice.findUnique({
              where: { id: record.linkedInvoiceId },
              select: { id: true, status: true, invoiceNo: true },
            })
          : null

      await prisma.$transaction(async (tx) => {
        if (linkedInvoice && linkedInvoice.status !== "CANCELLED") {
          await voidInvoice(tx, {
            invoiceId: linkedInvoice.id,
            companyId,
            invoiceNo: linkedInvoice.invoiceNo,
            integrationStatus: "REJECTED:RED",
            createdBy: user.id,
          })
        }
        await tx.incomingInvoice.update({
          where: { companyId_uuid: { companyId, uuid } },
          data: { status: "RED" },
        })
      })
    } else {
      await prisma.incomingInvoice.update({
        where: { companyId_uuid: { companyId, uuid } },
        data: { status: "KABUL" },
      })
    }

    return NextResponse.json({
      success: true,
      status: action === "accept" ? "KABUL" : "RED",
      message: result.message,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("inbox respond route error:", error)
    return NextResponse.json(
      { error: message || "Yanıt gönderilirken hata oluştu." },
      { status: 500 },
    )
  }
}
