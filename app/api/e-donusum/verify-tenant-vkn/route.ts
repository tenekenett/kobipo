import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { MysoftEInvoiceProvider } from "@/lib/integrations/e-invoice/mysoft-provider"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { decryptSecret } from "@/lib/crypto/secrets"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Verilen VKN'yi Mysoft'a karşı doğrula: `/api/Tenant/getDocumentNumberList?vknTckn=VKN`
 * çağrısı succeed dönerse VKN Mysoft hesabında tanımlı bir mükellef demektir.
 *
 * Başarılı doğrulama → `company.eDonusumTenantVkn` DB'ye yazılır.
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const { vkn } = body || {}
    // companyId dashboard'dan slug gelebilir → cuid'e çevir. [[resolve-company.ts]]
    const companyId = await resolveCompanyId(body?.companyId)

    if (!companyId) {
      return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    }
    const cleanVkn = typeof vkn === "string" ? vkn.replace(/\D/g, "") : ""
    if (cleanVkn.length !== 10 && cleanVkn.length !== 11) {
      return NextResponse.json(
        { error: "VKN 10 hane (kurumsal) veya 11 hane (gerçek kişi) olmalı." },
        { status: 400 },
      )
    }

    await ensureCompanyWrite(companyId)
    assertEInvoiceRuntimeReady()

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        eDonusumApiUsername: true,
        eDonusumApiPassword: true,
        eDonusumApiUrl: true,
      },
    })
    if (!company?.eDonusumApiUsername || !company?.eDonusumApiPassword) {
      return NextResponse.json(
        { error: "Önce E-Dönüşüm Ayarları'na API kullanıcı adı/şifresini yazıp kaydedin." },
        { status: 400 },
      )
    }

    let passwordText: string
    try {
      passwordText = decryptSecret(company.eDonusumApiPassword)
    } catch {
      return NextResponse.json(
        { error: "Kayıtlı şifre çözülemedi. Şifreyi tekrar girip kaydedin." },
        { status: 400 },
      )
    }

    const provider = new MysoftEInvoiceProvider({
      username: company.eDonusumApiUsername,
      passwordText,
      baseUrl: company.eDonusumApiUrl || undefined,
    })

    const result = await provider.listNumerators(cleanVkn)
    if (!result.success) {
      // Stale (eski/yanlış) bir VKN DB'de kayıtlıysa temizle — kullanıcı önceki
      // bir keşiften kalan değerle "Doğrulandı" badge'i görmesin.
      await prisma.company.updateMany({
        where: { id: companyId, eDonusumTenantVkn: cleanVkn },
        data: { eDonusumTenantVkn: null },
      })
      return NextResponse.json(
        { success: false, error: result.error || "VKN doğrulanamadı." },
        { status: 200 },
      )
    }

    await prisma.company.update({
      where: { id: companyId },
      data: { eDonusumTenantVkn: cleanVkn },
    })

    return NextResponse.json({
      success: true,
      vkn: cleanVkn,
      numeratorCount: Array.isArray(result.data) ? result.data.length : 0,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("verify-tenant-vkn error:", error)
    return NextResponse.json(
      { error: message || "Doğrulama sırasında hata." },
      { status: 500 },
    )
  }
}
