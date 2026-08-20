import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Firmanın faturalarında DAHA ÖNCE kullanılmış kategori ve etiketleri döner.
 *
 * Kategori/etiket ayrı tabloda tutulmaz (ürün kategorisiyle aynı desen: serbest
 * metin). Kullanıcının her seferinde yeniden yazmaması ve yazım farklarından
 * ("Akaryakıt" / "akaryakit") kırılımın bölünmemesi için mevcut değerleri öneri
 * olarak sunuyoruz.
 *
 * GET /api/e-donusum/invoices/classifications?companyId=...
 *   → { categories: string[], tags: string[] }
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

    const [categoryRows, tagRows] = await Promise.all([
      prisma.invoice.findMany({
        where: { companyId, category: { not: null } },
        select: { category: true },
        distinct: ["category"],
        orderBy: { category: "asc" },
        take: 200,
      }),
      // tags String[] olduğu için distinct kullanılamaz; son faturaların etiketlerini
      // toplayıp bellekte tekilleştiriyoruz (öneri listesi, tam envanter değil).
      prisma.invoice.findMany({
        where: { companyId, NOT: { tags: { isEmpty: true } } },
        select: { tags: true },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
    ])

    const categories = categoryRows
      .map((r) => r.category)
      .filter((c): c is string => Boolean(c && c.trim()))

    const tags = Array.from(new Set(tagRows.flatMap((r) => r.tags))).sort((a, b) =>
      a.localeCompare(b, "tr"),
    )

    return NextResponse.json({ categories, tags })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("invoice classifications error:", error)
    return NextResponse.json(
      { error: message || "Kategori/etiket listesi alınamadı." },
      { status: 500 },
    )
  }
})
