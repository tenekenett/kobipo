import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { Prisma } from "@prisma/client"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { normalizeDesignOptions } from "@/lib/integrations/e-invoice/template-designer"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import {
  isTemplateStale,
  sampleVersionForDocType,
} from "@/lib/integrations/e-invoice/sample-templates"

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
export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    const eDocumentType = parseDocType(searchParams.get("eDocumentType"))
    const xsltName = (searchParams.get("xsltName") || "").trim()

    await ensureCompanyAccess(companyId)

    // Tek şablonun tasarım seçeneklerini iste (düzenleme için önceden doldurma).
    if (xsltName) {
      if (!eDocumentType) {
        return NextResponse.json({ error: "Geçerli belge tipi gerekli." }, { status: 400 })
      }
      const row = await prisma.eInvoiceTemplate.findUnique({
        where: { companyId_eDocumentType_xsltName: { companyId, eDocumentType, xsltName } },
        select: { xsltName: true, eDocumentType: true, options: true },
      })
      if (!row || row.options == null) {
        // Kaynağı bizde olmayan şablon tasarımcıya yüklenemez (bkz. designs/preview).
        return NextResponse.json(
          {
            error:
              "Bu şablonun kaynağı Kobipo'da yok (portalden ya da XSLT dosyasıyla eklenmiş), " +
              "bu yüzden düzenlenemez. Şablon Tasarımcısı'ndan yeni bir tasarım oluşturabilirsiniz.",
          },
          { status: 404 },
        )
      }
      return NextResponse.json({ xsltName: row.xsltName, eDocumentType: row.eDocumentType, options: row.options })
    }

    const rows = await prisma.eInvoiceTemplate.findMany({
      where: { companyId, ...(eDocumentType ? { eDocumentType } : {}) },
      select: {
        xsltName: true,
        eDocumentType: true,
        isActive: true,
        options: true,
        hidden: true,
        updatedAt: true,
        baseVersion: true,
        refreshedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    })

    // Gizlenenler listeden/aktiften düşülür; ayrı bir alanda geri-getirme için döner.
    const visible = rows.filter((r) => !r.hidden)
    // Taban şablon değiştiyse (ör. kalem notu satırı eklendi) kayıtlı tasarım
    // BAYATTIR: Mysoft'taki kopya eski görselle basmaya devam eder. Arayüz bunu
    // rozetle gösterip "Yenile" düğmesini öne çıkarır.
    // Liste iki belge tipini birden taşıyabilir; sürüm satırın kendi tipinden okunur.
    const [efaturaVersion, earsivVersion] = await Promise.all([
      sampleVersionForDocType(1),
      sampleVersionForDocType(2),
    ])
    const versionOf = (t: number) => (t === 1 ? efaturaVersion : t === 2 ? earsivVersion : null)
    const data = visible.map((r) => ({
      xsltName: r.xsltName,
      eDocumentType: r.eDocumentType,
      isActive: r.isActive,
      hasOptions: r.options != null,
      stale: isTemplateStale(r, versionOf(r.eDocumentType)),
      refreshedAt: r.refreshedAt,
    }))
    const active = visible.find((r) => r.isActive)
    const hiddenXsltNames = rows.filter((r) => r.hidden).map((r) => r.xsltName)

    return NextResponse.json({ data, activeXsltName: active?.xsltName ?? null, hiddenXsltNames })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("templates designs GET error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// POST { companyId, eDocumentType, xsltName, options } → tasarım seçeneklerini sakla
export const POST = withApiErrors(async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    // companyId dashboard'dan slug gelebilir → cuid'e çevir (GET zaten çeviriyor;
    // POST'ta atlanırsa tasarım kaydetme "Access denied" verir). [[resolve-company.ts]]
    const companyId = await resolveCompanyId(body.companyId)
    const { xsltName, options } = body
    const eDocumentType = parseDocType(body.eDocumentType)
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    if (!eDocumentType) return NextResponse.json({ error: "Geçerli belge tipi gerekli." }, { status: 400 })
    if (typeof xsltName !== "string" || !xsltName.trim()) {
      return NextResponse.json({ error: "Şablon adı zorunlu." }, { status: 400 })
    }

    await ensureCompanyWrite(companyId)

    const normalized = normalizeDesignOptions(options) as unknown as Prisma.InputJsonValue
    const name = xsltName.trim()

    // Tasarım hangi taban sürümünden üretildi — bayatlık bunun üzerinden ölçülür.
    const baseVersion = await sampleVersionForDocType(eDocumentType)
    await prisma.eInvoiceTemplate.upsert({
      where: { companyId_eDocumentType_xsltName: { companyId, eDocumentType, xsltName: name } },
      create: { companyId, eDocumentType, xsltName: name, options: normalized, baseVersion },
      // Yeniden kaydedilen tasarım daha önce gizlenmişse görünür hale gelir.
      update: { options: normalized, hidden: false, baseVersion },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("templates designs POST error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
