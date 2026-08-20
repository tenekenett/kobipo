import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import {
  resolveCompanyEInvoiceProvider,
  COMPANY_PROVIDER_SELECT,
} from "@/lib/integrations/e-invoice/company-provider"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Gelen e-fatura listesi.
 *
 * Default kaynak: DB (önceden sync ile çekilmiş kayıtlar). Hızlıdır, paginate edilebilir.
 * source=live verilirse Mysoft'a canlı çağrı yapar — DB'ye yazmaz, ham snapshot döner.
 *
 * Query params:
 *  - companyId   (zorunlu)
 *  - source      ("db" default | "live")
 *  - status      ("KABUL" | "RED" | ...) DB modunda filtre
 *  - days        DB modunda son N gün; live modda çağrı aralığı (default 30)
 *  - startDate   ISO; verilirse days override
 *  - endDate     ISO
 *  - raw         "1" → live modda Mysoft ham JSON da döner
 */
export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const url = new URL(request.url)
    const companyId = await resolveCompanyId(url.searchParams.get("companyId"))
    if (!companyId) {
      return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    }

    await ensureCompanyAccess(companyId)

    const source = url.searchParams.get("source") === "live" ? "live" : "db"
    const days = Number(url.searchParams.get("days") || "30")
    const endParam = url.searchParams.get("endDate")
    const startParam = url.searchParams.get("startDate")
    const end = endParam ? new Date(endParam) : new Date()
    const start = startParam
      ? new Date(startParam)
      : new Date(end.getTime() - Math.max(1, days) * 24 * 60 * 60 * 1000)

    if (source === "db") {
      const status = url.searchParams.get("status") || undefined
      const records = await prisma.incomingInvoice.findMany({
        where: {
          companyId,
          docDate: { gte: start, lte: end },
          ...(status ? { status } : {}),
        },
        orderBy: [{ docDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        take: 500,
      })
      // Mysoft raw JSON'ından gönderilme tarihini çıkar — sürüm farklılıklarına
      // karşı birden çok olası alan adını dene. Yoksa null döner.
      const extractSentDate = (raw: any): string | null => {
        if (!raw || typeof raw !== "object") return null
        const candidates = [
          "envelopeDate",
          "sendDate",
          "createDate",
          "createdDate",
          "lastTrackingDate",
          "documentCreateDate",
          "createDateUtc",
        ]
        for (const k of candidates) {
          const v = raw[k]
          if (typeof v === "string" && v.trim()) return v
        }
        return null
      }

      return NextResponse.json({
        source: "db",
        dateRange: { startDate: start.toISOString(), endDate: end.toISOString() },
        count: records.length,
        data: records.map((r) => ({
          id: r.id,
          uuid: r.uuid,
          invoiceNo: r.invoiceNo,
          date: r.docDate ? r.docDate.toISOString() : null,
          sentDate: extractSentDate(r.raw),
          sender: { name: r.senderName, taxNumber: r.senderTaxNumber },
          profile: r.profile,
          invoiceType: r.invoiceType,
          currency: r.currencyCode,
          taxExclusiveAmount: r.taxExclusiveAmount,
          vatAmount: r.vatAmount,
          totalAmount: r.payableAmount,
          status: r.status,
          envelopeStatusCode: r.envelopeStatusCode,
          envelopeStatusDesc: r.envelopeStatusDesc,
          isArchived: r.isArchived,
          isLinkedToPurchase: r.isLinkedToPurchase,
          linkedInvoiceId: r.linkedInvoiceId,
          syncedAt: r.syncedAt.toISOString(),
        })),
      })
    }

    // source = live → Mysoft canlı (DB yazımı yok)
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

    const wantRaw = url.searchParams.get("raw") === "1"
    const result = await provider.listIncomingInvoices({
      startDate: start,
      endDate: end,
      raw: wantRaw,
    })

    if (!result.success) {
      return NextResponse.json(
        { error: result.error, rawResponse: result.rawResponse ?? null },
        { status: 400 },
      )
    }

    return NextResponse.json({
      source: "live",
      dateRange: { startDate: start.toISOString(), endDate: end.toISOString() },
      count: result.data.length,
      data: result.data,
      rawResponse: wantRaw ? result.rawResponse ?? null : undefined,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("inbox route error:", error)
    return NextResponse.json(
      { error: message || "Gelen fatura listesi alınırken hata oluştu." },
      { status: 500 },
    )
  }
})
