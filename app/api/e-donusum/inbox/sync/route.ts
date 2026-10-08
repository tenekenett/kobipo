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
import { syncIncomingInvoices } from "@/lib/integrations/e-invoice/inbox-sync"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"
// 6 ay / 1 yıllık aralık Mysoft tarafında 90 günlük pencerelere bölünüp sırayla
// çekilir; varsayılan (10 sn) sınır bunun için dar kalıyor.
export const maxDuration = 60

/**
 * Mysoft'tan gelen e-faturaları çekip DB'ye upsert eder.
 *
 * Body (opsiyonel):
 *  - companyId  (zorunlu)
 *  - days       (default 30)  — son N gün
 *  - startDate  (ISO)         — verilirse days override
 *  - endDate    (ISO)
 *
 * Mantık lib/integrations/e-invoice/inbox-sync.ts'tedir (fatura e-postası taraması
 * da oturumsuz aynı fonksiyonu çağırır); bu uç yetki + sağlayıcı + aralık çözer.
 */
export const POST = withApiErrors(async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const { days, startDate: rawStart, endDate: rawEnd } = body || {}
    // companyId dashboard'dan slug gelebilir → cuid'e çevir. [[resolve-company.ts]]
    const companyId = await resolveCompanyId(body?.companyId)
    if (!companyId) {
      return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    }

    await ensureCompanyWrite(companyId)
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

    const end = rawEnd ? new Date(rawEnd) : new Date()
    const daysNum = Number(days) > 0 ? Number(days) : 30
    const start = rawStart
      ? new Date(rawStart)
      : new Date(end.getTime() - daysNum * 24 * 60 * 60 * 1000)

    const result = await syncIncomingInvoices({
      companyId,
      provider,
      start,
      end,
      actorId: user.id,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    const { ok: _ok, ...summary } = result
    return NextResponse.json({
      dateRange: { startDate: start.toISOString(), endDate: end.toISOString() },
      // Mysoft 90 günlük pencerelerden biri alınamadıysa liste EKSİKTİR; sessizce
      // "başarılı" demiyoruz, uyarıyı kullanıcıya kadar taşıyoruz.
      ...summary,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("inbox sync error:", error)
    return NextResponse.json(
      { error: message || "Sync sırasında hata oluştu." },
      { status: 500 },
    )
  }
})
