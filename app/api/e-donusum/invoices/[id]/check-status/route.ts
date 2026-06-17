import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { createEInvoiceProvider } from "@/lib/integrations/e-invoice/factory"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { decryptSecret } from "@/lib/crypto/secrets"
import { revertInvoiceStock } from "@/lib/stock/warehouse"

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
      select: {
        eDonusumApiUsername: true,
        eDonusumApiPassword: true,
        eDonusumApiUrl: true,
      },
    })

    if (!company?.eDonusumApiUsername || !company?.eDonusumApiPassword) {
      return NextResponse.json(
        { error: "Mysoft API bilgileri eksik. E-Dönüşüm ayarlarını kontrol edin." },
        { status: 400 }
      )
    }

    assertEInvoiceRuntimeReady()
    const plainPassword = decryptSecret(company.eDonusumApiPassword)
    const provider = createEInvoiceProvider({
      providerName: "mysoft",
      username: company.eDonusumApiUsername,
      passwordText: plainPassword,
      apiUrl: company.eDonusumApiUrl || undefined,
    })

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

    // Mysoft'tan dönen detaylı durumu integrationStatus'a yaz
    const integrationStatus = `${result.status}:${result.rawText || result.message}`

    // İç status mapping
    // - APPROVED → invoice.status: "SENT" (zaten gönderilmiş; alt-statüsü integrationStatus'ta)
    // - CANCELLED → invoice.status: "CANCELLED"
    // - REJECTED → invoice.status: SENT kalır, integrationStatus REJECTED:... olur
    // - PROCESSING/DRAFT → değiştirmeyelim
    const becomesCancelled = result.status === "CANCELLED" && invoice.status !== "CANCELLED"
    const updateData: { status?: string; integrationStatus: string } = {
      integrationStatus,
    }
    if (becomesCancelled) {
      updateData.status = "CANCELLED"
    }

    if (becomesCancelled) {
      // Portal/GİB tarafında iptal edilmiş: stoğu geri al ve durumu güncelle (atomik).
      // Bakiye otomatik düzelir (cari sorguları CANCELLED faturaları hariç tutar).
      await prisma.$transaction(async (tx) => {
        await revertInvoiceStock(tx, {
          companyId: invoice.companyId,
          invoiceId: invoice.id,
          invoiceNo: invoice.invoiceNo,
          createdBy: user.id,
        })
        await tx.invoice.update({ where: { id: invoice.id }, data: updateData })
      })
    } else {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: updateData,
      })
    }

    return NextResponse.json({
      success: true,
      status: result.status,
      rawText: result.rawText,
      message: result.message,
      declineReason: result.declineReason,
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
