import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { MysoftEInvoiceProvider } from "@/lib/integrations/e-invoice/mysoft-provider"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { decryptSecret } from "@/lib/crypto/secrets"

export const dynamic = "force-dynamic"

/**
 * TEŞHİS ucu — hiçbir şey YAZMAZ, sadece okur.
 * Bir Mysoft hesabının İş Ortağı/bayi durumunu ve bağlı olduğu ana iş ortağını tespit eder:
 *  - getBusinessPartnerTariff: tarife dönüyorsa hesabın bayi yetkisi var.
 *  - getBusinessPartnerDocumentCreditList: mainBusinessPartner alanları bağlı olunan bayiyi gösterir.
 */

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

    await ensureCompanyAccess(companyId)
    assertEInvoiceRuntimeReady()

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        eDonusumApiUsername: true,
        eDonusumApiPassword: true,
        eDonusumApiUrl: true,
        eDonusumTenantVkn: true,
      },
    })
    if (!company?.eDonusumApiUsername || !company?.eDonusumApiPassword) {
      return NextResponse.json(
        { error: "Mysoft API bilgileri eksik. E-Dönüşüm Ayarları'nı kontrol edin." },
        { status: 400 },
      )
    }

    let passwordText: string
    try {
      passwordText = decryptSecret(company.eDonusumApiPassword)
    } catch {
      return NextResponse.json(
        { error: "Şifre çözülemedi. E-Dönüşüm şifresini tekrar girin." },
        { status: 400 },
      )
    }

    const provider = new MysoftEInvoiceProvider({
      username: company.eDonusumApiUsername,
      passwordText,
      baseUrl: company.eDonusumApiUrl || undefined,
      vknTckn: (company.eDonusumTenantVkn || "").replace(/\D/g, "") || undefined,
    })

    const [tariff, mainBp, subBp] = await Promise.all([
      provider.getBusinessPartnerTariff(50),
      provider.getBusinessPartnerDocumentCreditList(1), // Ana iş ortağı
      provider.getBusinessPartnerDocumentCreditList(2), // Alt iş ortağı
    ])

    // Bağlı olunan ana iş ortağı (bayi) — herhangi bir satırdan topla.
    const mainPartners = [...mainBp.data, ...subBp.data]
      .map((r: any) => ({
        vkn: r?.mainBusinessPartnerIdentifierNumber || null,
        name: r?.mainBusinessPartnerName || null,
      }))
      .filter((p) => p.vkn || p.name)
    const uniqueMainPartners = Array.from(
      new Map(mainPartners.map((p) => [`${p.vkn}-${p.name}`, p])).values(),
    )

    const hasPartnerTariffs = tariff.success && tariff.data.length > 0
    const hasSubPartners = subBp.success && subBp.data.length > 0

    let interpretation: string
    if (hasPartnerTariffs || hasSubPartners) {
      interpretation =
        "Bu hesabın İŞ ORTAĞI/BAYİ yetkisi var (tarife veya alt iş ortağı tanımlı). " +
        "Yani bu hesapla başka mükelleflere kontör yükleyebilirsiniz."
    } else if (uniqueMainPartners.length > 0) {
      interpretation =
        "Bu hesap bir bayiye BAĞLI bir mükellef gibi görünüyor. Bağlı olduğu ana iş ortağı(lar): " +
        uniqueMainPartners.map((p) => `${p.name || "?"} (${p.vkn || "?"})`).join(", ") +
        ". Bu VKN Kobipo'nun İş Ortağı VKN'siyse hesap Kobipo'ya bağlıdır."
    } else {
      interpretation =
        "Bu hesapta bayi tarifesi, alt iş ortağı veya bağlı ana iş ortağı bilgisi BULUNAMADI. " +
        "Büyük olasılıkla bağımsız/standart bir mükellef hesabı — Kobipo bayiliğine bağlı görünmüyor."
    }

    return NextResponse.json({
      verdict: {
        hasPartnerTariffs,
        hasSubPartners,
        mainPartners: uniqueMainPartners,
        interpretation,
      },
      tariff: { ok: tariff.success, status: tariff.status, count: tariff.data.length, error: tariff.error, sample: tariff.data.slice(0, 3) },
      mainBusinessPartner: { ok: mainBp.success, status: mainBp.status, count: mainBp.data.length, error: mainBp.error, rows: mainBp.data },
      subBusinessPartner: { ok: subBp.success, status: subBp.status, count: subBp.data.length, error: subBp.error, rows: subBp.data },
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("partner-check GET error:", error)
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 })
  }
}
