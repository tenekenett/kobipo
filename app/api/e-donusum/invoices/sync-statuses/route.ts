import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import {
  resolveCompanyEInvoiceProvider,
  COMPANY_PROVIDER_SELECT,
} from "@/lib/integrations/e-invoice/company-provider"
import { voidInvoice, evaluateGibVoid } from "@/lib/integrations/e-invoice/void-invoice"

export const dynamic = "force-dynamic"

/**
 * GİB/entegratör tarafındaki GİDEN fatura durumlarını TOPLU senkronize eder.
 *
 * NEDEN: Alıcı bir giden e-faturayı reddettiğinde (RED), bu bilgi bize ancak
 * durum sorgusuyla ulaşır. Tek tek "Durumu Kontrol Et" (check-status) manuel bir
 * iştir; kullanıcı her faturayı tek tek kontrol etmezse reddedilen faturanın
 * tutarı müşterinin cari borcunda kalır. Bu uç nokta, gönderilmiş (SENT) ve UUID'si
 * olan tüm faturaları tek seferde GİB'e sorar; RED/İPTAL olanları CANCELLED yapar
 * (+ stok iade). Böylece reddedilen faturalar cari bakiyeden otomatik düşer.
 *
 * Body: { companyId: string, limit?: number }
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const companyId = await resolveCompanyId(body?.companyId)
    if (!companyId) {
      return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    }
    // Aşırı çağrıyı sınırla; varsayılan 200 fatura/istek.
    const limit = Math.min(Math.max(Number(body?.limit) || 200, 1), 500)

    await ensureCompanyAccess(companyId)
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

    const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

    // Yalnızca kesinleşmiş (SENT) ve UUID'si olan faturalar reddedilebilir/iptal olabilir.
    const invoices = await prisma.invoice.findMany({
      where: {
        companyId,
        status: "SENT",
        uuid: { not: null },
      },
      select: { id: true, uuid: true, invoiceNo: true, integrationStatus: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    })

    let checked = 0
    let voided = 0
    let unchanged = 0
    const errors: Array<{ invoiceNo: string | null; error: string }> = []

    for (const inv of invoices) {
      if (!inv.uuid || !guidRegex.test(inv.uuid)) {
        continue
      }
      try {
        const result: any = await provider.getInvoiceStatus(inv.uuid)
        checked++
        if (!result?.success) {
          errors.push({ invoiceNo: inv.invoiceNo, error: result?.error || "Durum sorgulanamadı" })
          continue
        }
        const { becomesVoid, integrationStatus } = evaluateGibVoid(result)
        if (becomesVoid) {
          await prisma.$transaction(async (tx) => {
            await voidInvoice(tx, {
              invoiceId: inv.id,
              companyId,
              invoiceNo: inv.invoiceNo,
              integrationStatus,
              createdBy: user.id,
            })
          })
          voided++
        } else {
          // Ham durumu integrationStatus'e yaz (geçersiz kılmadan).
          if (integrationStatus !== inv.integrationStatus) {
            await prisma.invoice.update({
              where: { id: inv.id },
              data: { integrationStatus },
            })
          }
          unchanged++
        }
      } catch (e: any) {
        errors.push({ invoiceNo: inv.invoiceNo, error: e?.message || "Durum sorgulanamadı" })
      }
    }

    return NextResponse.json({
      success: true,
      total: invoices.length,
      checked,
      voided,
      unchanged,
      errors,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("sync-statuses error:", error)
    return NextResponse.json(
      { error: message || "Durum senkronizasyonu sırasında hata oluştu." },
      { status: 500 },
    )
  }
}
