import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import {
  DEFAULT_RECEIPT_TEMPLATE,
  normalizeReceiptTemplate,
  type ReceiptTemplate,
} from "@/lib/fis/receipt-template"

export const dynamic = "force-dynamic"

/**
 * Fiş tasarım şablonu (firma başına tek) — Company.receiptTemplate.
 *
 * GET  ?companyId=  → { template, isDefault }
 * PUT  { companyId, template } → { template }
 *
 * Şablon hiç kaydedilmemişse varsayılan döner (isDefault:true) ve fiş bugünkü
 * sabit görünümüyle basılır.
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const url = new URL(request.url)
    const companyId = await resolveCompanyId(url.searchParams.get("companyId") || undefined)
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

    await ensureCompanyAccess(companyId)

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        receiptTemplate: true,
        // Künye: showAddress/showContact açıkken fişe basılır. Hızlı satış/alış bu
        // veriyi başka yerden alamıyor (dashboard context'inde yalnız id+name var).
        name: true,
        address: true,
        phone: true,
        taxOffice: true,
        taxNumber: true,
      },
    })
    if (!company) return NextResponse.json({ error: "Firma bulunamadı" }, { status: 404 })

    const saved = company.receiptTemplate
    return NextResponse.json({
      template: saved ? normalizeReceiptTemplate(saved) : DEFAULT_RECEIPT_TEMPLATE,
      isDefault: !saved,
      company: {
        name: company.name,
        address: company.address,
        phone: company.phone,
        taxOffice: company.taxOffice,
        taxNumber: company.taxNumber,
      },
    })
  } catch (error: any) {
    if (error?.message?.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching receipt template:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const companyId = await resolveCompanyId(body?.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

    await ensureCompanyWrite(companyId)

    // İstemciye güvenilmez: logo yalnız png/jpeg data URL + boyut sınırlı, metinler
    // kırpılır, genişlik iki değerden biri (bkz. normalizeReceiptTemplate).
    const template: ReceiptTemplate = normalizeReceiptTemplate(body?.template)

    await prisma.company.update({
      where: { id: companyId },
      data: { receiptTemplate: template },
    })

    return NextResponse.json({ template })
  } catch (error: any) {
    if (error?.message?.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error saving receipt template:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
