import { prisma } from "@/lib/db/prisma"
import { createEInvoiceProvider } from "@/lib/integrations/e-invoice/factory"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { decryptSecret } from "@/lib/crypto/secrets"

export type SendInvoiceResult =
  | { ok: true; uuid: string; providerName: string }
  | { ok: false; status: number; error: string; integrationStatus: string }

/**
 * Bir faturayı Mysoft'a (veya konfigüre edilmiş e-Belge sağlayıcısına) gönderir.
 * Hem ilk gönderim (POST /api/e-donusum/invoices) hem de "Yeniden Gönder"
 * (POST /api/e-donusum/invoices/[id]) bu helper'ı kullanır.
 *
 * - invoiceSeriesPrefix Mysoft payload'ına KARIŞMAZ — sadece eFaturaPrefix/eArchivePrefix.
 * - Hiçbiri tanımlı değilse provider Mysoft'tan aktif default numaratörü otomatik seçer.
 * - Mysoft "numaratör bulunamadı" hatası kullanıcıya CTA içeren mesaja dönüştürülür.
 */
export async function sendInvoiceToProvider(invoiceId: string): Promise<SendInvoiceResult> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: true,
      supplier: true,
      items: true,
    },
  })

  if (!invoice) {
    return { ok: false, status: 404, error: "Fatura bulunamadı", integrationStatus: "" }
  }

  if (invoice.status !== "DRAFT") {
    return {
      ok: false,
      status: 400,
      error: "Sadece taslak faturalar gönderilebilir.",
      integrationStatus: "",
    }
  }

  if (invoice.type !== "SALES") {
    return {
      ok: false,
      status: 400,
      error: "Sadece satış faturaları e-belge olarak gönderilebilir.",
      integrationStatus: "",
    }
  }

  if (invoice.invoiceType !== "E_INVOICE" && invoice.invoiceType !== "E_ARCHIVE") {
    return {
      ok: false,
      status: 400,
      error: "Sadece e-Fatura veya e-Arşiv faturalar gönderilebilir.",
      integrationStatus: "",
    }
  }

  const company = await prisma.company.findUnique({
    where: { id: invoice.companyId },
    select: {
      isEDonusumEnabled: true,
      name: true,
      taxNumber: true,
      taxOffice: true,
      address: true,
      city: true,
      eDonusumApiUsername: true,
      eDonusumApiPassword: true,
      eDonusumApiUrl: true,
      eDonusumTenantVkn: true,
      eFaturaPrefix: true,
      eArchivePrefix: true,
    },
  })

  if (!company) {
    return { ok: false, status: 404, error: "Firma bulunamadı", integrationStatus: "" }
  }

  if (!company.isEDonusumEnabled) {
    return {
      ok: false,
      status: 400,
      error: "Bu firmada e-fatura özelliği kapalı.",
      integrationStatus: "",
    }
  }

  if (!company.eDonusumApiUsername || !company.eDonusumApiPassword) {
    return {
      ok: false,
      status: 400,
      error: "Mysoft API bilgileri eksik. E-Dönüşüm ayarlarını kontrol edin.",
      integrationStatus: "",
    }
  }

  try {
    assertEInvoiceRuntimeReady()
  } catch (error: any) {
    return {
      ok: false,
      status: 503,
      error: error?.message || "E-belge çalışma zamanı hazır değil.",
      integrationStatus: "",
    }
  }

  const plainPassword = decryptSecret(company.eDonusumApiPassword)
  // Mysoft mükellef VKN: E-Dönüşüm Ayarları'nda kullanıcının doğruladığı VKN.
  // Boşsa Mysoft default tenant'a düşer — fakat hangi tenant olduğunu garanti edemeyiz.
  // Onaylanmış VKN varsa onunla gönderiyoruz.
  const tenantVkn = (company.eDonusumTenantVkn || "").replace(/\D/g, "")
  const provider = createEInvoiceProvider({
    providerName: "mysoft",
    username: company.eDonusumApiUsername,
    passwordText: plainPassword,
    apiUrl: company.eDonusumApiUrl || undefined,
    vknTckn: tenantVkn || undefined,
  })

  // Mysoft prefix: kullanıcı seçmediyse undefined geç (provider auto-pick eder).
  // invoiceSeriesPrefix Kobipo iç numarası içindir, Mysoft'a KARIŞMAZ.
  const resolvedPrefix: string | undefined =
    invoice.invoiceType === "E_INVOICE"
      ? company.eFaturaPrefix || undefined
      : company.eArchivePrefix || undefined

  // ÖNEMLİ: connectorGuid / pkAlias / gbAlias Mysoft'a GÖNDERME.
  // - connectorGuid: createInvoiceOutboxTestJson endpoint'i her çağrıda random
  //   GUID dönüyor; saklayıp tekrar göndermek anlamsız.
  // - pkAlias/gbAlias: sample payload'da "urn:mail:defaultpk@mysoft.com.tr" gibi
  //   generic placeholder dönüyor — gerçek alias değil.
  // Mysoft tenantIdentifierNumber'dan gerçek connector + alias'ı kendi seçer.
  const invoiceData = {
    invoiceType: invoice.invoiceType as "E_INVOICE" | "E_ARCHIVE",
    prefix: resolvedPrefix,
    tenantIdentifierNumber: tenantVkn || undefined,
    invoiceNo: invoice.invoiceNo,
    date: invoice.date,
    dueDate: invoice.dueDate || undefined,
    sender: {
      name: company.name,
      taxNumber: company.taxNumber,
      taxOffice: company.taxOffice,
      address: company.address,
      city: company.city,
    },
    customer: invoice.customer
      ? {
          name: invoice.customer.name,
          taxNumber: invoice.customer.taxNumber || undefined,
          taxOffice: invoice.customer.taxOffice || undefined,
          address: invoice.customer.address || undefined,
          city: invoice.customer.city || undefined,
          country: invoice.customer.country || undefined,
        }
      : undefined,
    supplier: invoice.supplier
      ? {
          name: invoice.supplier.name,
          taxNumber: invoice.supplier.taxNumber || undefined,
          taxOffice: invoice.supplier.taxOffice || undefined,
          address: invoice.supplier.address || undefined,
          city: invoice.supplier.city || undefined,
          country: invoice.supplier.country || undefined,
        }
      : undefined,
    items: invoice.items.map((item) => ({
      description: item.description,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      vatRate: Number(item.vatRate),
      productId: item.productId || undefined,
      taxExemptionReasonCode: item.taxExemptionReasonCode || undefined,
      taxExemptionReason: item.taxExemptionReason || undefined,
    })),
    notes: invoice.notes || undefined,
  }

  const response: any = await provider.sendInvoice(invoiceData)

  if (response.success && response.uuid) {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        uuid: response.uuid,
        status: "SENT",
        integrationId: provider.name,
        integrationStatus: "SENT",
      },
    })
    return { ok: true, uuid: response.uuid, providerName: provider.name }
  }

  // Hata: friendly mesaja çevir ve kaydet.
  const rawError: string = response.error || "UNKNOWN"
  const lower = rawError.toLowerCase()
  const isNumeratorError =
    lower.includes("numaratör") ||
    lower.includes("numarator") ||
    lower.includes("aktif numaratör tanımlı değil")
  // Mysoft errorCode 00013: "İlgili hesap için fatura pk bilgisi bulunamadı. VKN : XXX"
  // Anlamı: alıcı GİB'de kayıtlı bir e-Fatura mükellefi değil (PK = posta kutusu).
  const isPkNotFoundError =
    lower.includes("fatura pk") ||
    lower.includes("fatura pk bilgisi bulunamadı") ||
    lower.includes("pk bilgisi bulunamadı")
  let friendlyError: string
  if (isNumeratorError) {
    // E-Fatura için "uygun numaratör bulunamadı" hatası YANILTICI olabilir:
    // gerçekte alıcının e-Fatura mükellefi olmaması (GİB kaydı yok) bu hatayı
    // tetikliyor. Kullanıcıya iki ihtimali de açıkla.
    if (invoice.invoiceType === "E_INVOICE") {
      friendlyError = resolvedPrefix
        ? `${rawError} → İki olası sebep: (1) "${resolvedPrefix}" prefix'i Mysoft panelinde E-Fatura için tanımlı/aktif değil — Seri No Tanımları'ndan başka bir prefix seçin. (2) Müşterinin VKN'si GİB'de kayıtlı bir e-Fatura mükellefi değil — bu durumda fatura E-Arşiv olarak kesilmeli.`
        : `${rawError} → İki olası sebep: (1) Mysoft panelinde E-Fatura için aktif numaratör yok. (2) Müşterinin VKN'si GİB'de kayıtlı bir e-Fatura mükellefi değil — E-Arşiv olarak kesin.`
    } else {
      friendlyError = resolvedPrefix
        ? `${rawError} → "${resolvedPrefix}" prefix'i Mysoft panelinde tanımlı/aktif değil. Seri No Tanımları sayfasından doğru prefix'i seçin veya yeni numaratör ekleyin.`
        : `${rawError} Seri No Tanımları sayfasından bu belge tipi için aktif bir numaratör ekleyin.`
    }
  } else if (isPkNotFoundError) {
    friendlyError =
      invoice.invoiceType === "E_INVOICE"
        ? `${rawError} → Müşteri GİB'de kayıtlı bir e-Fatura mükellefi değil (ya da VKN/TCKN'si hatalı). Müşteri kartındaki Vergi Numarası alanını kontrol edin; mükellef değilse bu fatura E-Arşiv olarak gönderilmeli.`
        : `${rawError} → Müşterinin VKN/TCKN bilgisini Müşteri Kartı'ndan kontrol edin.`
  } else {
    friendlyError = rawError
  }

  const integrationStatus = `ERROR:${friendlyError}`
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { integrationStatus },
  })

  return {
    ok: false,
    status: 400,
    error: friendlyError,
    integrationStatus,
  }
}
