import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { MysoftEInvoiceProvider } from "@/lib/integrations/e-invoice/mysoft-provider"
import { createPartnerProvider } from "@/lib/integrations/e-invoice/partner"
import { decryptSecret } from "@/lib/crypto/secrets"

export const dynamic = "force-dynamic"

/**
 * Bir VKN/TCKN'nin e-fatura mükellef durumunu döner. InvoiceEditor müşteri/tedarikçi
 * seçildiğinde bu endpoint'i çağırıp invoiceType'ı (E_INVOICE vs E_ARCHIVE) otomatik
 * belirler.
 *
 * Query params:
 *  - companyId  (zorunlu)
 *  - vkn        (zorunlu)
 *
 * Yanıt:
 *  - isEInvoiceTaxpayer: boolean
 *  - suggestedInvoiceType: "E_INVOICE" | "E_ARCHIVE" | "MANUAL"
 *  - accountName, eInvoiceStartDate (debug için)
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const url = new URL(request.url)
    const companyId = url.searchParams.get("companyId")
    const vkn = (url.searchParams.get("vkn") || "").replace(/\D/g, "")
    if (!companyId) {
      return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    }
    if (!vkn || !/^\d{10,11}$/.test(vkn)) {
      return NextResponse.json(
        {
          error: "Geçersiz VKN/TCKN",
          isEInvoiceTaxpayer: false,
          suggestedInvoiceType: "MANUAL",
        },
        { status: 400 },
      )
    }

    await ensureCompanyAccess(companyId)
    assertEInvoiceRuntimeReady()

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        isEDonusumEnabled: true,
        eDonusumApiUsername: true,
        eDonusumApiPassword: true,
        eDonusumApiUrl: true,
        eDonusumTenantVkn: true,
      },
    })

    // GİB mükellef sicili global veridir; hangi Mysoft hesabıyla sorgulandığı sonucu
    // değiştirmez. Bu yüzden sorguyu DAİMA elimizdeki bayi (partner) hesabıyla yaparız
    // — böylece firma kendi e-Dönüşümünü kurmasa da "VKN'den Getir" çalışır. Bayi
    // yapılandırılmamışsa firmanın kendi kimliğine düşeriz.
    let provider = createPartnerProvider()
    if (!provider && company?.eDonusumApiUsername && company?.eDonusumApiPassword) {
      try {
        provider = new MysoftEInvoiceProvider({
          username: company.eDonusumApiUsername,
          passwordText: decryptSecret(company.eDonusumApiPassword),
          baseUrl: company.eDonusumApiUrl || undefined,
          vknTckn: company.eDonusumTenantVkn || undefined,
        })
      } catch {
        provider = null
      }
    }

    if (!provider) {
      return NextResponse.json({
        isEInvoiceTaxpayer: false,
        suggestedInvoiceType: "MANUAL",
        reason: "VKN sorgusu için Mysoft yapılandırması yok",
      })
    }

    // Firmanın kendisi e-belge GÖNDEREBİLİYOR mu? (önerilecek fatura tipini belirler)
    const companyCanSend = Boolean(
      company?.isEDonusumEnabled && company?.eDonusumApiUsername && company?.eDonusumApiPassword,
    )
    const fallbackType = companyCanSend ? "E_ARCHIVE" : "MANUAL"

    const result = await provider.getGibAccount(vkn)
    if (!result.success) {
      return NextResponse.json({
        isEInvoiceTaxpayer: false,
        suggestedInvoiceType: fallbackType,
        reason: result.error,
      })
    }

    if (!result.data) {
      return NextResponse.json({
        isEInvoiceTaxpayer: false,
        suggestedInvoiceType: fallbackType,
        accountName: null,
        eInvoiceStartDate: null,
      })
    }

    // GİB hesap modelinden ek detaylar (adres/vergi dairesi GİB'de YOKTUR; yalnızca
    // aşağıdakiler gelir). raw modelden çıkarılıp forma zengin bilgi sağlanır.
    const raw: any = result.data.raw || {}
    const accountType: number | null =
      typeof raw.gibAccountType === "number" ? raw.gibAccountType : null
    const aliasList: any[] = Array.isArray(raw.gibAccountAliasList) ? raw.gibAccountAliasList : []
    const aliases: string[] = Array.from(
      new Set(
        aliasList
          .map((a) => String(a?.alias || "").replace(/^urn:mail:/i, "").trim())
          .filter(Boolean),
      ),
    )

    // Önerilen tip: firma e-belge gönderemiyorsa MANUAL; gönderebiliyorsa müşteri
    // e-Fatura mükellefiyse E_INVOICE, değilse E_ARCHIVE.
    const suggestedInvoiceType = !companyCanSend
      ? "MANUAL"
      : result.data.isEInvoiceTaxpayer
        ? "E_INVOICE"
        : "E_ARCHIVE"

    return NextResponse.json({
      isEInvoiceTaxpayer: result.data.isEInvoiceTaxpayer,
      suggestedInvoiceType,
      accountName: result.data.accountName,
      eInvoiceStartDate: result.data.eInvoiceStartDate,
      eWaybillStartDate: result.data.eWaybillStartDate,
      isPassive: result.data.isPassive,
      // 1 = Tüzel (şirket), 2 = Şahıs (gerçek kişi)
      accountType,
      aliases,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("check-vkn route error:", error)
    return NextResponse.json(
      { error: message || "VKN kontrolü sırasında hata oluştu" },
      { status: 500 },
    )
  }
}
