import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

/**
 * Bir belge dizaynını (xsltName) firma + belge tipi için AKTİF yapar. Fatura
 * gönderiminde bu şablon kullanılır (payload.xsltName). Mysoft set-default API'si
 * olmadığından seçim Kobipo'da tutulur. Aktif yapılan şablon Kobipo tasarımı
 * olmayabilir (portalden/yüklenmiş) — yalnız adı saklanır, önizleme için seçenek
 * gerekmez.
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const { companyId, xsltName } = body
    const eDocumentType = Number(body.eDocumentType)
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    if (eDocumentType !== 1 && eDocumentType !== 2) {
      return NextResponse.json({ error: "Geçerli belge tipi gerekli." }, { status: 400 })
    }
    // Boş xsltName = aktif seçimi kaldır (Mysoft varsayılanına dön).
    const name = typeof xsltName === "string" ? xsltName.trim() : ""

    await ensureCompanyAccess(companyId)

    await prisma.$transaction(async (tx) => {
      // Aynı firma+tip içindeki tüm aktif bayrakları sıfırla.
      await tx.eInvoiceTemplate.updateMany({
        where: { companyId, eDocumentType, isActive: true },
        data: { isActive: false },
      })
      if (name) {
        // Seçilen şablonu aktif yap (Kobipo tasarımı değilse satırı options'sız oluştur).
        await tx.eInvoiceTemplate.upsert({
          where: { companyId_eDocumentType_xsltName: { companyId, eDocumentType, xsltName: name } },
          create: { companyId, eDocumentType, xsltName: name, isActive: true },
          update: { isActive: true },
        })
      }
    })

    return NextResponse.json({ success: true, activeXsltName: name || null })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("templates activate error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
