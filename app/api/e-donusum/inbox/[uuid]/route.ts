import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { MysoftEInvoiceProvider } from "@/lib/integrations/e-invoice/mysoft-provider"
import { decryptSecret } from "@/lib/crypto/secrets"
import { effectiveTenantVkn } from "@/lib/integrations/e-invoice/tenant"

export const dynamic = "force-dynamic"

/**
 * Tek bir gelen e-faturanın detayını döner.
 *
 * Query params:
 *  - companyId (zorunlu)
 *  - withModel ("1" verilirse Mysoft'tan tam invoice modelini de çeker — kalemler dahil)
 *
 * Path: /api/e-donusum/inbox/{ettn}
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ uuid: string }> },
) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { uuid } = await params
    if (!uuid) {
      return NextResponse.json({ error: "uuid (ETTN) zorunlu" }, { status: 400 })
    }

    const url = new URL(request.url)
    const companyId = await resolveCompanyId(url.searchParams.get("companyId"))
    if (!companyId) {
      return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    }
    const wantModel = url.searchParams.get("withModel") === "1"

    await ensureCompanyAccess(companyId)

    const record = await prisma.incomingInvoice.findUnique({
      where: { companyId_uuid: { companyId, uuid } },
    })
    if (!record) {
      return NextResponse.json({ error: "Kayıt bulunamadı" }, { status: 404 })
    }

    // DB kaydını her durumda dön
    const base = {
      id: record.id,
      uuid: record.uuid,
      invoiceNo: record.invoiceNo,
      date: record.docDate ? record.docDate.toISOString() : null,
      sender: { name: record.senderName, taxNumber: record.senderTaxNumber },
      profile: record.profile,
      invoiceType: record.invoiceType,
      currency: record.currencyCode,
      currencyRate: record.currencyRate,
      taxExclusiveAmount: record.taxExclusiveAmount,
      taxInclusiveAmount: record.taxInclusiveAmount,
      vatAmount: record.vatAmount,
      totalAmount: record.payableAmount,
      vatBreakdown: record.vatBreakdown,
      status: record.status,
      envelopeStatusCode: record.envelopeStatusCode,
      envelopeStatusDesc: record.envelopeStatusDesc,
      isArchived: record.isArchived,
      isLinkedToPurchase: record.isLinkedToPurchase,
      linkedInvoiceId: record.linkedInvoiceId,
      raw: record.raw,
      syncedAt: record.syncedAt.toISOString(),
    }

    if (!wantModel) {
      return NextResponse.json(base)
    }

    // Mysoft'tan tam model — kalem detayları için
    assertEInvoiceRuntimeReady()
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        eDonusumApiUsername: true,
        eDonusumApiPassword: true,
        eDonusumApiUrl: true,
        taxNumber: true,
        eDonusumTenantVkn: true,
        parentCompany: { select: { taxNumber: true } },
      },
    })
    if (!company?.eDonusumApiUsername || !company?.eDonusumApiPassword) {
      return NextResponse.json(
        {
          ...base,
          model: null,
          modelError:
            "Mysoft erişimi yok — E-Dönüşüm Ayarları'na kullanıcı adı/şifre giriniz.",
        },
        { status: 200 },
      )
    }

    let passwordText: string
    try {
      passwordText = decryptSecret(company.eDonusumApiPassword)
    } catch {
      return NextResponse.json(
        { ...base, model: null, modelError: "Kayıtlı şifre çözülemedi." },
        { status: 200 },
      )
    }

    const provider = new MysoftEInvoiceProvider({
      username: company.eDonusumApiUsername,
      passwordText,
      baseUrl: company.eDonusumApiUrl || undefined,
      vknTckn: effectiveTenantVkn(company) || undefined,
    })

    const result = await provider.getIncomingInvoiceModel(uuid)
    if (!result.success) {
      const raw = result.error || "Bilinmeyen hata"
      const low = raw.toLowerCase()
      // Tüm tenant adayları denendikten sonra hâlâ firma-kullanıcı hatası geliyorsa,
      // sorun VKN doğrulama DEĞİL, Mysoft API kullanıcısının bu mükellefe bağlı
      // olmamasıdır. Kullanıcıyı kayıtlı kullanıcı adı/şifresini kontrol etmeye yönlendir.
      const modelError =
        low.includes("firma kullanıcı") || low.includes("kullanıcı bilgileri")
          ? `${raw} — Mysoft API kullanıcınız bu firmaya bağlı görünmüyor. E-Dönüşüm Ayarları'ndan kayıtlı Mysoft kullanıcı adı/şifrenizi kontrol edip yeniden kaydedin.`
          : raw
      return NextResponse.json({ ...base, model: null, modelError }, { status: 200 })
    }

    return NextResponse.json({ ...base, model: result.data })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("inbox detail route error:", error)
    return NextResponse.json(
      { error: message || "Detay alınırken hata oluştu." },
      { status: 500 },
    )
  }
}
