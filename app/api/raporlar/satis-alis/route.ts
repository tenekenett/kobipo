import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { computeSalesPurchaseReport, type SalesPurchaseKind } from "@/lib/raporlar/satis-alis"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Satış / alış raporu. Hesabın kendisi `lib/raporlar/satis-alis.ts`te — dışa
 * aktarma ucu da aynı fonksiyonu çağırır.
 *
 * Bu uç, ekranı dosyayla aynı kaynağa bağlamak için açıldı: ekranlar önceden
 * `/api/e-donusum/invoices`ten TÜM faturaları çekip tarayıcıda topluyordu, dosya
 * ise sunucuda hesaplanıyordu. Tarih aralığı yalnız dosyada vardı ve iki sonuç
 * (iade işaretleri, matrah/KDV) birbirini tutmuyordu.
 */
export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    }

    await ensureCompanyAccess(companyId)

    const type: SalesPurchaseKind =
      String(searchParams.get("type") || "SALES").toUpperCase() === "PURCHASE" ? "PURCHASE" : "SALES"

    return NextResponse.json(
      await computeSalesPurchaseReport({
        companyId,
        type,
        startDate: searchParams.get("startDate"),
        endDate: searchParams.get("endDate"),
        // Kalemler yalnız "Detaylı Faturalar" alt sayfası için çekilir: kalem
        // sorgusu fatura sayısıyla büyür, özet ekranını yavaşlatır.
        includeLines: searchParams.get("includeLines") === "1",
        class1Id: searchParams.get("class1Id"),
        class2Id: searchParams.get("class2Id"),
      })
    )
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error generating sales/purchase report:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
