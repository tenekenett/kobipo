import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { Prisma } from "@prisma/client"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { normalizeDesignOptions } from "@/lib/integrations/e-invoice/template-designer"

export const dynamic = "force-dynamic"

/**
 * Kobipo Şablon Tasarımcısı ile üretilmiş belge dizaynları (firma DB'sinde tutulur).
 * Mysoft kayıtlı XSLT içeriğini geri vermediğinden, önizleme/aktif-yapma için
 * tasarım seçeneklerini burada saklarız. Mysoft'taki şablon listesiyle `xsltName`
 * üzerinden eşleşir.
 */

function parseDocType(value: unknown): number | null {
  const n = Number(value)
  return n === 1 || n === 2 ? n : null
}

// GET ?companyId=&eDocumentType= → bu firma+tip için Kobipo tasarımları + aktif seçim
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get("companyId")
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    const eDocumentType = parseDocType(searchParams.get("eDocumentType"))

    await ensureCompanyAccess(companyId)

    const rows = await prisma.eInvoiceTemplate.findMany({
      where: { companyId, ...(eDocumentType ? { eDocumentType } : {}) },
      select: { xsltName: true, eDocumentType: true, isActive: true, options: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    })

    const data = rows.map((r) => ({
      xsltName: r.xsltName,
      eDocumentType: r.eDocumentType,
      isActive: r.isActive,
      hasOptions: r.options != null,
    }))
    const active = rows.find((r) => r.isActive)

    return NextResponse.json({ data, activeXsltName: active?.xsltName ?? null })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("templates designs GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// POST { companyId, eDocumentType, xsltName, options } → tasarım seçeneklerini sakla
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const { companyId, xsltName, options } = body
    const eDocumentType = parseDocType(body.eDocumentType)
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    if (!eDocumentType) return NextResponse.json({ error: "Geçerli belge tipi gerekli." }, { status: 400 })
    if (typeof xsltName !== "string" || !xsltName.trim()) {
      return NextResponse.json({ error: "Şablon adı zorunlu." }, { status: 400 })
    }

    await ensureCompanyAccess(companyId)

    const normalized = normalizeDesignOptions(options) as unknown as Prisma.InputJsonValue
    const name = xsltName.trim()

    await prisma.eInvoiceTemplate.upsert({
      where: { companyId_eDocumentType_xsltName: { companyId, eDocumentType, xsltName: name } },
      create: { companyId, eDocumentType, xsltName: name, options: normalized },
      update: { options: normalized },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("templates designs POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
