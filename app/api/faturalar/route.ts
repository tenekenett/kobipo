import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { fetchInvoiceList } from "@/lib/faturalar/list-query"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Birleşik fatura listesi — gelen + giden.
 *
 * Sorgunun kendisi `lib/faturalar/list-query.ts`te; dışa aktarma ucu da aynı
 * fonksiyonu (daha yüksek satır tavanıyla) çağırır, böylece ekranla indirilen
 * dosya aynı kayıtları gösterir.
 *
 * Query params:
 *  - companyId   (zorunlu)
 *  - direction   ("all" default | "incoming" | "outgoing")
 *  - days        (default 90) — son N gün; startDate verilirse görmezden gelinir
 *  - startDate   ISO
 *  - endDate     ISO
 *  - status      filtre (KABUL/RED/DRAFT/SENT/...)
 *  - search      fatura no / karşı taraf adı / VKN / ETTN
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const url = new URL(request.url)
    const companyId = await resolveCompanyId(url.searchParams.get("companyId"))
    if (!companyId) {
      return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    }

    await ensureCompanyAccess(companyId)

    const includeInboxParam = url.searchParams.get("includeInbox")

    const result = await fetchInvoiceList({
      companyId,
      direction: (url.searchParams.get("direction") || "all") as "all" | "incoming" | "outgoing",
      includeInbox: includeInboxParam === null ? true : includeInboxParam !== "false",
      days: Number(url.searchParams.get("days") || "90"),
      startDate: url.searchParams.get("startDate"),
      endDate: url.searchParams.get("endDate"),
      status: url.searchParams.get("status"),
      search: url.searchParams.get("search"),
    })

    return NextResponse.json({
      dateRange: result.dateRange,
      totals: result.totals,
      count: result.count,
      data: result.data,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("faturalar route error:", error)
    return NextResponse.json(
      { error: message || "Faturalar listesi alınırken hata oluştu." },
      { status: 500 },
    )
  }
}
