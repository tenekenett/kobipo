import { prisma } from "@/lib/db/prisma"
import {
  getSeriesTemplateOverride,
  getXsltNameForSeries,
  hasSeriesTemplates,
  invoiceTypeToEDocumentType,
} from "@/lib/integrations/e-invoice/active-template"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { resolveCompanyEInvoiceProvider } from "@/lib/integrations/e-invoice/company-provider"

export type SendInvoiceResult =
  | { ok: true; uuid: string; providerName: string }
  | { ok: false; status: number; error: string; integrationStatus: string }

export type DraftPdfResult =
  | { ok: true; pdfBuffer: Buffer; filename: string }
  | { ok: false; status: number; error: string }

type SendContext =
  | {
      ok: true
      invoice: {
        id: string
        companyId: string
        uuid: string | null
        eDocumentNo: string | null
      }
      provider: any
      invoiceData: any
      effectiveInvoiceType: "E_INVOICE" | "E_ARCHIVE"
      resolvedPrefix?: string
      /** Geçmiş tarihli belge reddedilirse denenecek yedek seri (Seri No Tanımları). */
      backdatePrefix?: string
    }
  | { ok: false; status: number; error: string; integrationStatus: string }

/**
 * Mysoft'un geçmiş tarih reddi mi? Ham mesaj:
 *   "Belge için uygun alternatif belge numarası bulunamamıştır. Belge tarihini eski
 *    tarih göndermeyiniz veya alternatif belge numarası tanımlayınız."
 * Sebep: GİB'de bir seri içindeki belge numaraları tarihle birlikte ilerlemek zorunda.
 * Seride bu faturadan DAHA GEÇ tarihli bir belge kesilmişse geçmiş tarihli faturaya
 * sıradaki numara verilemez; Mysoft o tarihe uygun ikinci (alternatif) bir seri arar.
 */
function isBackdateNumberError(rawError: unknown): boolean {
  if (typeof rawError !== "string") return false
  return /alternatif belge numaras/i.test(rawError) || /eski tarih/i.test(rawError)
}

/** YYYY-MM-DD — verilen zaman diliminde takvim günü. */
const dayIn = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone }).format(date)

/**
 * Fatura bugünden ÖNCEKİ bir güne mi düzenlendi? Gün karşılaştırması mükellefin
 * takvimine göre yapılır (sunucu UTC'de çalışsa da). Fatura tarihi saatsiz seçilip
 * UTC gece yarısı olarak saklandığı için invoice.date UTC gününden okunur.
 */
function isBackdatedInvoice(date: Date): boolean {
  return dayIn(date, "UTC") < dayIn(new Date(), "Europe/Istanbul")
}

/**
 * Bir e-belge faturasını Mysoft'a göndermek/önizlemek için ORTAK bağlamı hazırlar:
 * faturayı+firmayı çeker, provider'ı çözer, e-Arşiv→e-Fatura VKN sorgusunu yapar,
 * prefix + xsltName'i belirler ve Mysoft `invoiceData` payload'ını kurar. Hem taslak
 * OLUŞTURMA (createGibDraft) hem taslak PDF ÖNİZLEME (getGibDraftPdf) bunu kullanır —
 * ikisi de Mysoft'un kabul ettiği AYNI tam modeli göndermelidir.
 */
async function resolveSendContext(
  invoiceId: string,
  opts: { requireStatus: "DRAFT" | "GIB_DRAFT"; eInvoiceProfile?: "TICARIFATURA" | "TEMELFATURA" },
): Promise<SendContext> {
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

  if (invoice.status !== opts.requireStatus) {
    return {
      ok: false,
      status: 400,
      error:
        opts.requireStatus === "DRAFT"
          ? "Sadece taslak faturalar gönderilebilir."
          : "Bu işlem yalnızca GİB taslağındaki faturada yapılabilir.",
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
      eDonusumOnboardingStatus: true,
      eFaturaPrefix: true,
      eArchivePrefix: true,
      eFaturaBackdatePrefix: true,
      eArchiveBackdatePrefix: true,
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

  // Provider'ı çöz: firmanın kendi Mysoft kimliği varsa onu (manuel), yoksa bayi altında
  // açıldıysa master bayi + tenantIdentifierNumber = firma VKN (Faz 4). tenantVkn firmanın
  // kendi VKN'sidir (şubede ana firmadan devralınır); boşsa provider JWT'den keşfeder.
  const resolved = resolveCompanyEInvoiceProvider(company)
  if (!resolved.ok) {
    return { ok: false, status: resolved.status, error: resolved.error, integrationStatus: "" }
  }
  const { provider, tenantVkn } = resolved

  // Alıcı VKN'sini GİB'de sorgula: E-Arşiv seçildiyse ama alıcı E-Fatura
  // mükellefiyse Mysoft "EARSIVFATURA profili geçersiz" diye reddediyor.
  // Burada otomatik olarak invoiceType'ı E_INVOICE'a çeviriyoruz ve DB'yi
  // güncelliyoruz ki preview ile gerçek belge tipi uyumlu olsun.
  let effectiveInvoiceType: "E_INVOICE" | "E_ARCHIVE" = invoice.invoiceType as
    | "E_INVOICE"
    | "E_ARCHIVE"
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
  const activePrefix: string | undefined =
    effectiveInvoiceType === "E_INVOICE"
      ? company.eFaturaPrefix || undefined
      : company.eArchivePrefix || undefined

  // Geçmiş tarihli belgeler için ayrılmış seri (Seri No Tanımları).
  const backdatePrefix: string | undefined =
    effectiveInvoiceType === "E_INVOICE"
      ? company.eFaturaBackdatePrefix || undefined
      : company.eArchiveBackdatePrefix || undefined

  // Fatura geçmiş tarihliyse ve bu iş için ayrılmış seri varsa belge DOĞRUDAN o
  // seriden numaralanır: ana seriye geçmiş tarihli belge yazmak, o serinin bundan
  // sonraki numaralarını da eski tarihe sabitler. Seri tanımlı değilse ana seriden
  // denenir; Mysoft reddederse createGibDraft'ta anlaşılır hata verilir.
  const useBackdateSeries = Boolean(backdatePrefix) && isBackdatedInvoice(invoice.date)
  const resolvedPrefix: string | undefined = useBackdateSeries ? backdatePrefix : activePrefix
  if (useBackdateSeries) {
    console.log(
      `[send-invoice-helper] Geçmiş tarihli fatura (${dayIn(invoice.date, "UTC")}) → geçmiş tarih serisi "${backdatePrefix}" kullanılıyor (fatura ${invoice.id}).`,
    )
  }

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

  const invoiceData: any = {
    invoiceType: effectiveInvoiceType,
    // Alıcının pinlediği posta kutusu (yoksa undefined → Mysoft otomatik seçer).
    pkAlias: receiverPkAlias,
    // E-Fatura'da kullanıcının seçtiği profil (Ticari/Temel). E-Arşiv'de yok sayılır.
    eInvoiceProfile:
      effectiveInvoiceType === "E_INVOICE" ? opts.eInvoiceProfile : undefined,
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
      // KDV tevkifatı: kod + tevkif edilen KDV yüzdesi. Provider satır KDV'sinden
      // (rowVat) matrah ve tutarı hesaplayıp Mysoft withholding alanlarına yazar.
      withholdingCode: item.withholdingCode || undefined,
      withholdingName: item.withholdingName || undefined,
      withholdingRate: Number(item.withholdingRate || 0),
      // ÖTV: oran + GİB liste kodu. Diğer Vergi: oran + ad (provider ad→kod çevirir).
      // Provider bunları iskonto sonrası matrah üzerinden tax[]'e yazar.
      exciseRate: Number(item.exciseRate || 0),
      exciseCode: item.exciseCode || undefined,
      otherTaxRate: Number(item.otherTaxRate || 0),
      otherTaxName: item.otherTaxName || undefined,
      otherTaxCode: item.otherTaxCode || undefined,
      taxExemptionReasonCode: item.taxExemptionReasonCode || undefined,
      taxExemptionReason: item.taxExemptionReason || undefined,
      // Satır iskontosu: tutar (hesaplanmış) + opsiyonel oran. Mysoft v8
      // invoiceDetail.allowanceCharge[]'a çevrilir; KDV matrahı net'ten hesaplanır.
      discountAmount: Number(item.discountAmount || 0),
      discountRate: Number(item.discountRate || 0),
    })),
    notes: invoice.notes || undefined,
    // Fatura altı (genel) iskonto tutarı (DB'de tutar olarak saklı). Header-level
    // allowanceCharge'a yansır, matrah tutar üzerinden oransal düşülür.
    globalDiscountAmount: Number(invoice.globalDiscountAmount || 0),
    globalChargeAmount: Number(invoice.globalChargeAmount || 0),
    payableRoundingAmount: Number(invoice.payableRoundingAmount || 0),
  }

  // Gönderimde kullanılacak belge dizaynını (xsltName) çöz: önce faturanın
  // prefix'ine (seri no) atanmış şablon, yoksa firma genel aktif şablonu.
  // Belge tipi olarak (E-Arşiv→E-Fatura otomatik dönüşümü olabildiğinden)
  // effectiveInvoiceType esas alınır; prefix de aynı tipe göre çözülmüştü.
  const eDocumentType = invoiceTypeToEDocumentType(effectiveInvoiceType)
  if (eDocumentType) {
    // Geçmiş tarih serisi şablonu MİRAS ALIR: kullanıcıdan bu seri için ayrıca
    // şablon tanımlaması beklenmez, faturalar normal serinin dizaynıyla basılır.
    // Yine de o seriye açıkça şablon atandıysa (Seri No Tanımları) o öne geçer.
    let prefixForTemplate = resolvedPrefix
    if (useBackdateSeries) {
      const override = await getSeriesTemplateOverride(
        invoice.companyId,
        eDocumentType,
        backdatePrefix,
      )
      prefixForTemplate = override ? backdatePrefix : activePrefix
    }
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
    if (xsltName) invoiceData.xsltName = xsltName
  }

  return {
    ok: true,
    invoice: {
      id: invoice.id,
      companyId: invoice.companyId,
      uuid: invoice.uuid,
      eDocumentNo: invoice.eDocumentNo,
    },
    provider,
    invoiceData,
    effectiveInvoiceType,
    resolvedPrefix,
    backdatePrefix,
  }
}

/**
 * Faturayı Mysoft'ta GİB TASLAĞI olarak oluşturur — GİB'e GÖNDERMEZ (isSaveAsDraft).
 * "Resmileştir" akışının 1. adımı: POST /api/e-donusum/invoices/[id] bunu çağırır.
 * Taslak ETTN + belge/sıra no üretilir; kullanıcı taslak PDF'ini görüp
 * finalizeGibDraft ile kesinleştirir (2. adım) ya da discardGibDraft ile geri alır.
 */
export async function createGibDraft(
  invoiceId: string,
  options?: { eInvoiceProfile?: "TICARIFATURA" | "TEMELFATURA" },
): Promise<SendInvoiceResult> {
  const ctx = await resolveSendContext(invoiceId, {
    requireStatus: "DRAFT",
    eInvoiceProfile: options?.eInvoiceProfile,
  })
  if (!ctx.ok) {
    return { ok: false, status: ctx.status, error: ctx.error, integrationStatus: ctx.integrationStatus }
  }
  const { provider, invoiceData, invoice, effectiveInvoiceType, resolvedPrefix, backdatePrefix } =
    ctx

  // isSaveAsDraft: Mysoft faturayı GİB'e GÖNDERMEZ, taslak olarak saklar. Aynı ettn
  // (payload.ettn = bizim ürettiğimiz GUID) ile finalizeGibDraft kesinleştirir.
  let response: any = await provider.sendInvoice({ ...invoiceData, isSaveAsDraft: true })

  // Emniyet ağı: gün olarak geçmiş SAYILMAYAN (bugün tarihli) bir belge de seride
  // daha yeni saatli/tarihli kayıt yüzünden reddedilebiliyor. Böyle bir durumda
  // geçmiş tarih serisiyle BİR KEZ daha dene. Zaten o seriden gönderdiysek atlanır.
  if (
    !response?.success &&
    isBackdateNumberError(response?.error) &&
    backdatePrefix &&
    backdatePrefix !== resolvedPrefix
  ) {
    const retryData: any = { ...invoiceData, prefix: backdatePrefix, isSaveAsDraft: true }
    // Şablon: geçmiş tarih serisine açıkça atanmış bir dizayn varsa o kullanılır;
    // yoksa invoiceData'daki (ana serinin) şablonu KORUNUR — belge aynı görünsün.
    const eDocumentType = invoiceTypeToEDocumentType(effectiveInvoiceType)
    const override = eDocumentType
      ? await getSeriesTemplateOverride(invoice.companyId, eDocumentType, backdatePrefix)
      : null
    if (override) retryData.xsltName = override
    console.log(
      `[send-invoice-helper] Geçmiş tarih hatası → yedek seri "${backdatePrefix}" ile tekrar deneniyor (fatura ${invoice.id}).`,
    )
    response = await provider.sendInvoice(retryData)
  }

  if (response.success && response.uuid) {
    const officialDocNo =
      typeof response.docNo === "string" && response.docNo.trim() ? response.docNo.trim() : null
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        uuid: response.uuid,
        // Taslakta üretilen belge/sıra no (isGenerateDocNoForDraft). Kesinleşmede güncellenebilir.
        ...(officialDocNo ? { eDocumentNo: officialDocNo } : {}),
        // GİB TASLAĞI: Mysoft'ta taslak var ama GİB'e gitmedi. uuid dolu olsa da
        // "gönderilmiş" DEĞİL — ayrım status==="SENT" ile yapılır.
        status: "GIB_DRAFT",
        integrationId: provider.name,
        integrationStatus: "DRAFT",
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
  if (isBackdateNumberError(rawError)) {
    const invoiceDay = invoiceData.date instanceof Date ? invoiceData.date : new Date(invoiceData.date)
    const dayLabel = Number.isFinite(invoiceDay.getTime())
      ? invoiceDay.toLocaleDateString("tr-TR", { timeZone: "UTC" })
      : "seçtiğiniz tarih"
    const seriesLabel = resolvedPrefix ? `"${resolvedPrefix}" serisinde` : "kullanılan seride"
    const rule =
      "Bir seride belge numaraları tarih sırasını bozamaz — seride bu tarihten daha yeni tarihli belge var."
    // Geçmiş tarih serisi tanımlıysa gönderim ya doğrudan ondan yapıldı ya da hata
    // sonrası onunla tekrar denendi; kullanıcıyı zaten yaptığımız çözüme yönlendirme.
    friendlyError = backdatePrefix
      ? `${rawError} → Geçmiş tarihli (${dayLabel}) fatura, geçmiş tarih serisi ` +
        `"${backdatePrefix}" ile de numara alamadı. ${rule} Seri No Tanımları'ndan hiç ` +
        `kullanılmamış yeni bir geçmiş tarih serisi tanımlayın veya fatura tarihini bugüne çekin.`
      : `${rawError} → Geçmiş tarihli (${dayLabel}) fatura kesilemedi: ${seriesLabel} ${rule} ` +
        `Çözüm: (1) fatura tarihini bugüne çekip tekrar gönderin, ya da (2) Seri No ` +
        `Tanımları'ndan geçmiş tarihli belgeler için ayrı bir seri tanımlayın — tanımlarsanız ` +
        `geçmiş tarihli faturalar otomatik olarak o seriden gider.`
  } else if (isNumeratorError) {
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

/**
 * GİB taslağının önizleme PDF'ini üretir. getInvoiceOutboxDraftPdfAsZip TAM fatura
 * modeli istediğinden, taslak oluştururken kullanılan aynı invoiceData'yı kurup
 * provider.sendInvoice'a draftPdfOnly=true ile veririz (ettn = mevcut taslağınki).
 */
export async function getGibDraftPdf(invoiceId: string): Promise<DraftPdfResult> {
  const ctx = await resolveSendContext(invoiceId, { requireStatus: "GIB_DRAFT" })
  if (!ctx.ok) return { ok: false, status: ctx.status, error: ctx.error }

  const response: any = await ctx.provider.sendInvoice({
    ...ctx.invoiceData,
    draftPdfOnly: true,
    ettn: ctx.invoice.uuid || undefined,
    // Taslakta atanmış belge numarasını önizlemeye taşı — boş gidince şablondaki
    // "Fatura No" alanı boş basılıyordu. Numara üretmez, yalnız PDF'e yazdırır.
    docNo: ctx.invoice.eDocumentNo || undefined,
  })

  if (!response.success || !response.pdfBuffer) {
    return { ok: false, status: 502, error: response.error || "Taslak PDF alınamadı." }
  }
  return { ok: true, pdfBuffer: response.pdfBuffer, filename: response.filename || "taslak.pdf" }
}

// ---- GİB Taslağı: kesinleştirme ve geri alma ----

type ProviderContext =
  | { ok: true; provider: any; tenantVkn: string | null; company: any }
  | { ok: false; status: number; error: string }

// Firmanın Mysoft provider'ını + tenant VKN'sini çözer. finalize/discard için ortak;
// bunlar invoiceData kurmaz (yalnız ettn ile çalışır) — o yüzden resolveSendContext'i kullanmaz.
async function resolveCompanyProvider(companyId: string): Promise<ProviderContext> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      isEDonusumEnabled: true,
      eDonusumApiUsername: true,
      eDonusumApiPassword: true,
      eDonusumApiUrl: true,
      eDonusumTenantVkn: true,
      eDonusumOnboardingStatus: true,
      eFaturaPrefix: true,
      eArchivePrefix: true,
      parentCompany: { select: { taxNumber: true } },
    },
  })
  if (!company) return { ok: false, status: 404, error: "Firma bulunamadı" }
  if (!company.isEDonusumEnabled)
    return { ok: false, status: 400, error: "Bu firmada e-fatura özelliği kapalı." }
  try {
    assertEInvoiceRuntimeReady()
  } catch (error: any) {
    return { ok: false, status: 503, error: error?.message || "E-belge çalışma zamanı hazır değil." }
  }
  const resolved = resolveCompanyEInvoiceProvider(company)
  if (!resolved.ok) return { ok: false, status: resolved.status, error: resolved.error }
  return { ok: true, provider: resolved.provider, tenantVkn: resolved.tenantVkn, company }
}

/**
 * GİB taslağını KESİNLEŞTİRİR: sendDraftInvoiceToGIB ile GİB'e gönderir. "Resmileştir"
 * akışının 2. adımı. Ön koşul: fatura GIB_DRAFT ve uuid (taslak ETTN) dolu.
 */
export async function finalizeGibDraft(invoiceId: string): Promise<SendInvoiceResult> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      companyId: true,
      status: true,
      uuid: true,
      invoiceType: true,
      eDocumentNo: true,
    },
  })
  if (!invoice) return { ok: false, status: 404, error: "Fatura bulunamadı", integrationStatus: "" }
  if (invoice.status !== "GIB_DRAFT" || !invoice.uuid) {
    return {
      ok: false,
      status: 400,
      error: "Yalnızca GİB taslağındaki faturalar kesinleştirilebilir.",
      integrationStatus: "",
    }
  }

  const ctx = await resolveCompanyProvider(invoice.companyId)
  if (!ctx.ok) return { ok: false, status: ctx.status, error: ctx.error, integrationStatus: "" }

  // Kesinleştirme taslakla AYNI seriden gitmeli. Taslakta numara üretildiyse
  // (eDocumentNo = 3 hane prefix + 4 hane yıl + 9 hane sıra) gerçek seri odur —
  // geçmiş tarih yedeğine düşülmüş olabileceği için firma ayarından türetmek yanlış
  // seriyi gönderir. Numara yoksa firmanın aktif serisine düş.
  const draftDocNo = (invoice.eDocumentNo || "").trim().toUpperCase()
  const draftPrefix = /^[A-Z0-9]{3}\d{13}$/.test(draftDocNo) ? draftDocNo.slice(0, 3) : undefined
  const resolvedPrefix: string | undefined =
    draftPrefix ||
    (invoice.invoiceType === "E_INVOICE"
      ? ctx.company.eFaturaPrefix || undefined
      : ctx.company.eArchivePrefix || undefined)

  const response = await ctx.provider.sendDraftToGib({
    ettn: invoice.uuid,
    prefix: resolvedPrefix,
    tenantIdentifierNumber: ctx.tenantVkn || undefined,
  })

  if (response.success) {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "SENT",
        integrationStatus: "SENT",
        ...(response.docNo ? { eDocumentNo: response.docNo } : {}),
      },
    })
    return { ok: true, uuid: invoice.uuid, providerName: ctx.provider.name }
  }

  const friendlyError = response.error || "Taslak GİB'e gönderilemedi."
  const integrationStatus = `ERROR:${friendlyError}`
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { integrationStatus },
  })
  return { ok: false, status: 400, error: friendlyError, integrationStatus }
}

/**
 * GİB taslağını GERİ ALIR: Mysoft'tan taslağı siler ve faturayı DRAFT'a döndürür
 * (yeniden düzenlenebilir). Ön koşul: fatura GIB_DRAFT.
 */
export async function discardGibDraft(invoiceId: string): Promise<SendInvoiceResult> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, companyId: true, status: true, uuid: true },
  })
  if (!invoice) return { ok: false, status: 404, error: "Fatura bulunamadı", integrationStatus: "" }
  if (invoice.status !== "GIB_DRAFT") {
    return {
      ok: false,
      status: 400,
      error: "Yalnızca GİB taslağındaki faturalar geri alınabilir.",
      integrationStatus: "",
    }
  }

  const ctx = await resolveCompanyProvider(invoice.companyId)
  if (!ctx.ok) return { ok: false, status: ctx.status, error: ctx.error, integrationStatus: "" }

  if (invoice.uuid) {
    const response = await ctx.provider.deleteDraft({
      ettn: invoice.uuid,
      tenantIdentifierNumber: ctx.tenantVkn || undefined,
    })
    if (!response.success) {
      return {
        ok: false,
        status: 400,
        error: response.error || "Taslak Mysoft'tan silinemedi.",
        integrationStatus: "",
      }
    }
  }

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: "DRAFT", uuid: null, eDocumentNo: null, integrationStatus: null },
  })
  return { ok: true, uuid: "", providerName: ctx.provider.name }
}
