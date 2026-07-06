import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

/**
 * Seri no (prefix) → belge şablonu (xsltName) eşlemeleri.
 * Bir prefix'e (ör. "ERA") kayıtlı bir tasarım (ör. "Kurumsal Mavi") atanır;
 * fatura gönderiminde faturanın prefix'ine atanmış şablon, firma genel aktif
 * şablonundan önce gelir (bkz. getXsltNameForSeries).
 */

function parseDocType(value: unknown): number | null {
  const n = Number(value)
  return n === 1 || n === 2 ? n : null
}

// GET ?companyId= → bu firmanın tüm prefix→şablon eşlemeleri
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

    await ensureCompanyAccess(companyId)

    const rows = await prisma.eInvoiceSeriesTemplate.findMany({
      where: { companyId },
      select: { eDocumentType: true, prefix: true, xsltName: true },
    })

    return NextResponse.json({ data: rows })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("series-templates GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST { companyId, eDocumentType, prefix, xsltName }
// xsltName boş/null → o prefix'in eşlemesi kaldırılır (genel aktif şablona döner).
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    // companyId dashboard'dan slug gelebilir → cuid'e çevir (GET zaten çeviriyor;
    // POST'ta atlanırsa "Ata" işlemi "Access denied" verir). [[resolve-company.ts]]
    const companyId = await resolveCompanyId(body.companyId)
    const eDocumentType = parseDocType(body.eDocumentType)
    const prefix = typeof body.prefix === "string" ? body.prefix.trim() : ""
    const xsltName = typeof body.xsltName === "string" ? body.xsltName.trim() : ""

    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    if (!eDocumentType) {
      return NextResponse.json({ error: "Geçerli belge tipi gerekli (1=E-Fatura, 2=E-Arşiv)." }, { status: 400 })
    }
    if (!prefix) return NextResponse.json({ error: "Prefix zorunlu." }, { status: 400 })

    await ensureCompanyAccess(companyId)

    const key = { companyId_eDocumentType_prefix: { companyId, eDocumentType, prefix } }

    if (!xsltName) {
      // Eşlemeyi kaldır (varsa). Yoksa sessiz geç.
      await prisma.eInvoiceSeriesTemplate.deleteMany({ where: { companyId, eDocumentType, prefix } })
      return NextResponse.json({ success: true, cleared: true })
    }

    await prisma.eInvoiceSeriesTemplate.upsert({
      where: key,
      create: { companyId, eDocumentType, prefix, xsltName },
      update: { xsltName },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("series-templates POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
