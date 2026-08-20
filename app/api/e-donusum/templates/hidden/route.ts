import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Şablon "silme" = Kobipo tarafında listeden gizleme.
 *
 * Mysoft API'si tanımlı XSLT'leri silmeyi/güncellemeyi desteklemediğinden
 * (Tenant grubunda yalnız add/get/preview var), kullanıcının "sildiği" şablonları
 * `eInvoiceTemplate.hidden=true` ile işaretleyip listeden çıkarırız. Şablon Mysoft
 * hesabında fiziksel olarak kalır; istenirse buradan geri getirilir (hidden=false).
 *
 * POST { companyId, eDocumentType, xsltName, hidden }
 */
function parseDocType(value: unknown): number | null {
  const n = Number(value)
  return n === 1 || n === 2 ? n : null
}

export const POST = withApiErrors(async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    // companyId dashboard'dan slug gelebilir → cuid'e çevir. [[resolve-company.ts]]
    const companyId = await resolveCompanyId(body.companyId)
    const eDocumentType = parseDocType(body.eDocumentType)
    const xsltName = typeof body.xsltName === "string" ? body.xsltName.trim() : ""
    const hidden = body.hidden === true

    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    if (!eDocumentType) {
      return NextResponse.json({ error: "Geçerli belge tipi gerekli (1=E-Fatura, 2=E-Arşiv)." }, { status: 400 })
    }
    if (!xsltName) return NextResponse.json({ error: "Şablon adı zorunlu." }, { status: 400 })

    await ensureCompanyWrite(companyId)

    const key = { companyId_eDocumentType_xsltName: { companyId, eDocumentType, xsltName } }

    // Gizlerken aktif seçimden de düşür (gizli şablon "gönderimde kullanılan" olamaz).
    await prisma.eInvoiceTemplate.upsert({
      where: key,
      create: { companyId, eDocumentType, xsltName, hidden, isActive: false },
      update: { hidden, ...(hidden ? { isActive: false } : {}) },
    })

    // Gizlerken bu şablona yapılmış seri no atamalarını da kaldır.
    if (hidden) {
      await prisma.eInvoiceSeriesTemplate.deleteMany({
        where: { companyId, eDocumentType, xsltName },
      })
    }

    return NextResponse.json({ success: true, hidden })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("templates hidden POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
