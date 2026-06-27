import { prisma } from "@/lib/db/prisma"
import {
  getXsltNameForSeries,
  hasSeriesTemplates,
  invoiceTypeToEDocumentType,
} from "@/lib/integrations/e-invoice/active-template"
import { createEInvoiceProvider } from "@/lib/integrations/e-invoice/factory"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { decryptSecret } from "@/lib/crypto/secrets"
import { effectiveTenantVkn } from "@/lib/integrations/e-invoice/tenant"

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
export async function sendInvoiceToProvider(
  invoiceId: string,
  options?: { eInvoiceProfile?: "TICARIFATURA" | "TEMELFATURA" },
): Promise<SendInvoiceResult> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: true,
      supplier: true,
      items: {
        include: { product: { select: { name: true } } },
      },
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
      parentCompany: { select: { taxNumber: true } },
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
  // Mysoft mükellef VKN: doğrudan firmanın kendi VKN'sinden (şubede ana firmadan
  // devralınır) çekilir — ayrı bir doğrulama adımı yoktur. Boşsa provider JWT'den keşfeder.
  const tenantVkn = effectiveTenantVkn(company)
  const provider = createEInvoiceProvider({
    providerName: "mysoft",
    username: company.eDonusumApiUsername,
    passwordText: plainPassword,
    apiUrl: company.eDonusumApiUrl || undefined,
    vknTckn: tenantVkn || undefined,
  })

  // Alıcı VKN'sini GİB'de sorgula: E-Arşiv seçildiyse ama alıcı E-Fatura
  // mükellefiyse Mysoft "EARSIVFATURA profili geçersiz" diye reddediyor.
  // Burada otomatik olarak invoiceType'ı E_INVOICE'a çeviriyoruz ve DB'yi
  // güncelliyoruz ki preview ile gerçek belge tipi uyumlu olsun.
  let effectiveInvoiceType: "E_INVOICE" | "E_ARCHIVE" = invoice.invoiceType as
    | "E_INVOICE"
    | "E_ARCHIVE"
  let autoSwitched = false
  const customerVkn = (invoice.customer?.taxNumber || "").replace(/\D/g, "")
  if (
    effectiveInvoiceType === "E_ARCHIVE" &&
    customerVkn &&
    /^\d{10,11}$/.test(customerVkn) &&
    typeof (provider as any).getGibAccount === "function"
  ) {
    try {
      const gibCheck = await (provider as any).getGibAccount(customerVkn)
      if (gibCheck?.success && gibCheck.data?.isEInvoiceTaxpayer) {
        effectiveInvoiceType = "E_INVOICE"
        autoSwitched = true
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { invoiceType: "E_INVOICE" },
        })
        console.log(
          `[send-invoice-helper] Alıcı VKN ${customerVkn} E-Fatura mükellefi (eInvoiceStartDate=${gibCheck.data.eInvoiceStartDate}). E-Arşiv → E-Fatura'ya çevrildi.`,
        )
      }
    } catch (e: any) {
      // GİB sorgusu yapılamadıysa orijinal seçimle devam et — Mysoft yine hata verirse alttaki yakalanır.
      console.warn("[send-invoice-helper] GİB sorgusu başarısız:", e?.message)
    }
  }

  // Mysoft prefix: kullanıcı seçmediyse undefined geç (provider auto-pick eder).
  // invoiceSeriesPrefix Kobipo iç numarası içindir, Mysoft'a KARIŞMAZ.
  const resolvedPrefix: string | undefined =
    effectiveInvoiceType === "E_INVOICE"
      ? company.eFaturaPrefix || undefined
      : company.eArchivePrefix || undefined

  // ÖNEMLİ: connectorGuid ve gbAlias (GÖNDERİCİ birim alias'ı) Mysoft'a GÖNDERME —
  // connectorGuid her çağrıda random döner; gbAlias'ı Mysoft tenantIdentifierNumber'dan
  // kendi seçer.
  // AMA outbox pkAlias = ALICININ posta kutusudur (swagger: "Alıcı firmanın posta
  // kutusu... birden fazla varsa tercih ettiğinizi girin; boşsa sistem ilk geçerliyi
  // otomatik atar. E-Arşiv'de boş bırakılmalı."). Müşteri kartında pinlenmiş bir kutu
  // varsa E-Fatura'da onu geçiyoruz; GİB alias'ları urn:mail: önekiyle beklenir.
  const rawReceiverAlias = (invoice.customer?.eInvoiceAlias || "").trim()
  const receiverPkAlias =
    effectiveInvoiceType === "E_INVOICE" && rawReceiverAlias
      ? /^urn:/i.test(rawReceiverAlias)
        ? rawReceiverAlias
        : `urn:mail:${rawReceiverAlias}`
      : undefined

  const invoiceData = {
    invoiceType: effectiveInvoiceType,
    // Alıcının pinlediği posta kutusu (yoksa undefined → Mysoft otomatik seçer).
    pkAlias: receiverPkAlias,
    // E-Fatura'da kullanıcının seçtiği profil (Ticari/Temel). E-Arşiv'de yok sayılır.
    eInvoiceProfile:
      effectiveInvoiceType === "E_INVOICE" ? options?.eInvoiceProfile : undefined,
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
          district: invoice.customer.district || undefined,
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
          district: invoice.supplier.district || undefined,
          country: invoice.supplier.country || undefined,
        }
      : undefined,
    items: invoice.items.map((item) => ({
      description: item.description?.trim() || item.product?.name || "",
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      vatRate: Number(item.vatRate),
      productId: item.productId || undefined,
      taxExemptionReasonCode: item.taxExemptionReasonCode || undefined,
      taxExemptionReason: item.taxExemptionReason || undefined,
    })),
    notes: invoice.notes || undefined,
  }

  // Gönderimde kullanılacak belge dizaynını (xsltName) çöz: önce faturanın
  // prefix'ine (seri no) atanmış şablon, yoksa firma genel aktif şablonu.
  // Belge tipi olarak (E-Arşiv→E-Fatura otomatik dönüşümü olabildiğinden)
  // effectiveInvoiceType esas alınır; prefix de aynı tipe göre çözülmüştü.
  const eDocumentType = invoiceTypeToEDocumentType(effectiveInvoiceType)
  if (eDocumentType) {
    let prefixForTemplate = resolvedPrefix
    // "Mysoft otomatik" (prefix seçilmemiş) durumda Mysoft kendi varsayılan
    // numaratörünü kullanır. O prefix'e atanmış bir şablon varsa firma geneli
    // aktif şablonun önüne geçmeli — bu yüzden gerçek varsayılan prefix'i çöz.
    // Yalnız bu firmada gerçekten prefix→şablon eşlemesi varsa Mysoft'a sor.
    if (!prefixForTemplate && (await hasSeriesTemplates(invoice.companyId, eDocumentType))) {
      try {
        const numResult: any = await (provider as any).listNumerators?.(tenantVkn || undefined)
        if (numResult?.success && Array.isArray(numResult.data)) {
          const matchesType = (n: any) => {
            const t = String(n?.edocumentType || "").toUpperCase()
            return effectiveInvoiceType === "E_INVOICE"
              ? t === "1" || t === "EFATURA"
              : t === "2" || t === "10" || t === "EARSIVFATURA" || t === "GIBEARSIVFATURA"
          }
          const candidates = numResult.data.filter((n: any) => matchesType(n) && !n?.isPassive)
          const def = candidates.find((n: any) => n?.isDefault) || candidates[0]
          if (def?.prefix) prefixForTemplate = String(def.prefix)
        }
      } catch {
        // Numaratör çözülemediyse genel aktif şablona düşülür (aşağıda).
      }
    }
    const xsltName = await getXsltNameForSeries(invoice.companyId, eDocumentType, prefixForTemplate)
    if (xsltName) (invoiceData as any).xsltName = xsltName
  }

  const response: any = await provider.sendInvoice(invoiceData)

  if (response.success && response.uuid) {
    const officialDocNo =
      typeof response.docNo === "string" && response.docNo.trim() ? response.docNo.trim() : null
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        uuid: response.uuid,
        // Mysoft resmi belge no'yu (seçilen prefix ile) gönderim yanıtında verirse
        // hemen kaydet; vermezse durum sorgusunda doldurulur.
        ...(officialDocNo ? { eDocumentNo: officialDocNo } : {}),
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
    if (effectiveInvoiceType === "E_INVOICE") {
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
      effectiveInvoiceType === "E_INVOICE"
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
