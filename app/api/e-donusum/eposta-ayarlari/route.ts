import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { hesapKurucusuBul } from "@/lib/fatura-eposta/kurucu.server"

export const dynamic = "force-dynamic"

/**
 * Fatura e-postası anahtarları (Ayarlar → E-Dönüşüm). DAR uç: yalnız iki bayrağı yazar.
 * Genel firma ucu (`PUT /api/companies/[id]`) gövdede gelmeyen alanları boşalttığı için
 * iki anahtarı oradan yazmak firmanın başka alanlarını silerdi.
 *
 * GET gelen bildiriminin GİDECEĞİ adresi de söyler (hesap kurucusu) — kullanıcı
 * bildirimin kime gittiğini ekranda görmeli.
 */
export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const url = new URL(request.url)
    const companyId = await resolveCompanyId(url.searchParams.get("companyId") || url.searchParams.get("company"))
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    await ensureCompanyAccess(companyId)

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { invoiceEmailAuto: true, incomingEmailNotify: true },
    })
    if (!company) return NextResponse.json({ error: "Firma bulunamadı" }, { status: 404 })
    const { kurucu } = await hesapKurucusuBul(companyId)
    return NextResponse.json({ ...company, incomingRecipient: kurucu?.email ?? null })
  } catch (error: any) {
    if (error?.message?.includes("Access denied")) return accessDeniedResponse(error)
    console.error("eposta-ayarlari GET:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withApiErrors(async function PUT(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const companyId = await resolveCompanyId(body?.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    await ensureCompanyWrite(companyId)

    const data: { invoiceEmailAuto?: boolean; incomingEmailNotify?: boolean } = {}
    if (typeof body?.invoiceEmailAuto === "boolean") data.invoiceEmailAuto = body.invoiceEmailAuto
    if (typeof body?.incomingEmailNotify === "boolean") data.incomingEmailNotify = body.incomingEmailNotify
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Değiştirilecek ayar yok" }, { status: 400 })
    }
    const updated = await prisma.company.update({
      where: { id: companyId },
      data,
      select: { invoiceEmailAuto: true, incomingEmailNotify: true },
    })
    return NextResponse.json(updated)
  } catch (error: any) {
    if (error?.message?.includes("Access denied")) return accessDeniedResponse(error)
    console.error("eposta-ayarlari PUT:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
