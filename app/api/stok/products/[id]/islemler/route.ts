import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { resolveSlugId } from "@/lib/slug-resolve"
import { withApiErrors } from "@/lib/api/errors"
import { computeProductTransactions, PRODUCT_TRANSACTION_LIMIT } from "@/lib/stock/urun-islemleri"

export const dynamic = "force-dynamic"

/**
 * Ürün kartının "Ürüne Ait Son 100 İşlem" tablosu — belge satırlarından (kural
 * lib/stock/urun-islemleri-kural.ts). Dışa aktarım (`urun-islemleri`) aynı
 * fonksiyonu çağırır.
 */
export const GET = withApiErrors(async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const companyHint = await resolveCompanyId(new URL(request.url).searchParams.get("companyId"))
  const productId = await resolveSlugId("product", id, companyHint)
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, companyId: true },
  })
  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 })
  }

  // Firma ürünün KENDİ kaydından okunur: istekteki companyId yalnız slug çözümü için.
  await ensureCompanyAccess(product.companyId)

  const rows = await computeProductTransactions({ companyId: product.companyId, productId: product.id })
  return NextResponse.json({ limit: PRODUCT_TRANSACTION_LIMIT, rows })
})
