import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import {
  resolveCompanyEInvoiceProvider,
  COMPANY_PROVIDER_SELECT,
} from "@/lib/integrations/e-invoice/company-provider"
import { voidInvoice, evaluateGibVoid } from "@/lib/integrations/e-invoice/void-invoice"

export const dynamic = "force-dynamic"

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      select: {
        id: true,
        companyId: true,
        uuid: true,
        status: true,
        integrationStatus: true,
        invoiceType: true,
        invoiceNo: true,
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: "Fatura bulunamadı" }, { status: 404 })
    }

    await ensureCompanyAccess(invoice.companyId)

    if (!invoice.uuid) {
      return NextResponse.json(
        { error: "Fatura henüz Mysoft'a gönderilmemiş (UUID yok)" },
        { status: 400 }
      )
    }

    // Mysoft, geçersiz formatta gelen ETTN için "Unrecognized Guid format" döner.
    // Erken yakala ve kullanıcıya net mesaj ver — gönderme sırasında bozuk değer kaydedilmiş olabilir.
    const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!guidRegex.test(invoice.uuid)) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          integrationStatus: `ERROR:Bozuk UUID kaydedilmiş (${invoice.uuid}). Faturayı tekrar göndermeniz gerekir.`,
        },
      })
      return NextResponse.json(
        {
          error:
            "Bu faturanın UUID'si Mysoft GUID formatında değil — gönderim sırasında ham yanıt yanlış kaydedilmiş olabilir. Faturayı tekrar göndermeyi deneyin.",
          uuid: invoice.uuid,
        },
        { status: 422 }
      )
    }

    const company = await prisma.company.findUnique({
      where: { id: invoice.companyId },
      select: COMPANY_PROVIDER_SELECT,
    })

    assertEInvoiceRuntimeReady()
    const resolved = resolveCompanyEInvoiceProvider(company)
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    }
    const provider = resolved.provider

    const result: any = await provider.getInvoiceStatus(invoice.uuid)

    if (!result?.success) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { integrationStatus: `ERROR:${result?.error || "Durum sorgulanamadı"}` },
      })
      return NextResponse.json(
        { error: result?.error || "Durum sorgulanamadı" },
        { status: 502 }
      )
    }

    // İç status mapping — TEK KARAR NOKTASI evaluateGibVoid (bkz. void-invoice.ts):
    // - APPROVED → invoice.status: "SENT" (zaten gönderilmiş; alt-statüsü integrationStatus'ta)
    // - CANCELLED (IPTAL_EDILDI) → invoice.status: "CANCELLED"
    // - REJECTED/RED (alıcı ticari faturayı reddetti) → belge geçersiz: iç status
    //   "CANCELLED" yapılır ki tüm cari/rapor sorguları (status <> CANCELLED) faturayı
    //   hariç tutsun; böylece alacak, müşterinin cari bakiyesinden düşer. integrationStatus
    //   "REJECTED:RED" olarak kalır → ekranda "İptal" değil "Reddedildi" olarak ayrışır.
    //   Yalnızca gerçek RED geçersiz kılar; HATA faturayı iptal ETMEZ.
    // - PROCESSING/DRAFT → değiştirmeyelim
    const { becomesVoid, integrationStatus } = evaluateGibVoid(result)
    const shouldVoid = becomesVoid && invoice.status !== "CANCELLED"

    const eDocumentNo =
      typeof result.docNo === "string" && result.docNo.trim() ? result.docNo.trim() : undefined

    if (shouldVoid) {
      // Belge geçersiz (iptal/red): stoğu geri al + status=CANCELLED (atomik).
      // Bakiye otomatik düzelir — cari sorguları CANCELLED'ı hariç tutar.
      await prisma.$transaction(async (tx) => {
        await voidInvoice(tx, {
          invoiceId: invoice.id,
          companyId: invoice.companyId,
          invoiceNo: invoice.invoiceNo,
          integrationStatus,
          createdBy: user.id,
        })
        if (eDocumentNo) {
          await tx.invoice.update({ where: { id: invoice.id }, data: { eDocumentNo } })
        }
      })
    } else {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { integrationStatus, ...(eDocumentNo ? { eDocumentNo } : {}) },
      })
    }

    return NextResponse.json({
      success: true,
      status: result.status,
      rawText: result.rawText,
      message: result.message,
      declineReason: result.declineReason,
      eDocumentNo,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error checking invoice status:", error)
    return NextResponse.json(
      { error: message || "Internal server error" },
      { status: 500 }
    )
  }
}
