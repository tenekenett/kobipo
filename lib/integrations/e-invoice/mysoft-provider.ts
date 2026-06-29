import { EInvoiceProvider } from "./types"
import { resolveMysoftBaseUrl } from "./constants"

// Mysoft ürün tipi kodları → okunur etiket (CreditRequestModel açıklamasından).
const MYSOFT_PRODUCT_LABELS: Record<number, string> = {
  1: "E-Fatura",
  2: "E-Arşiv Fatura",
  3: "E-İrsaliye",
  4: "E-Defter",
  5: "E-SMM",
  6: "E-MM",
  7: "E-Bilet",
  8: "CRM",
  9: "Ön Muhasebe",
  10: "IYS",
  12: "İzin Yönetimi",
  13: "E-Döviz",
  16: "E-Adisyon",
  17: "Mutabakat",
  18: "E-Arşiv Fatura (GİB)",
}

export class MysoftEInvoiceProvider implements EInvoiceProvider {
  name = "Mysoft";
  private username: string;
  private passwordText: string;
  private baseUrl: string;
  // Mysoft Tenant endpoint'leri (Numaratör listesi/ekleme) zorunlu olarak vknTckn ister.
  // Constructor'da verilirse onu kullanırız; yoksa runtime'da /api/Tenant/getTenant ile
  // login kullanıcısının yetkili olduğu ilk aktif mükellefin VKN'si keşfedilir ve cache'lenir.
  private vknTckn?: string;
  private resolvedTenantVkn?: string;

  constructor(config: { username: string; passwordText: string; baseUrl?: string; vknTckn?: string }) {
    this.username = config.username;
    this.passwordText = config.passwordText;
    this.baseUrl = resolveMysoftBaseUrl(config.baseUrl);
    this.vknTckn = typeof config.vknTckn === "string" && config.vknTckn.trim()
      ? config.vknTckn.trim()
      : undefined;
  }

  /**
   * Login kullanıcısının yetkili olduğu ilk aktif mükellefin VKN/TCKN'sini döndürür.
   * Mysoft Tenant endpoint'leri için zorunlu. Sonuç provider instance'ında cache'lenir.
   */
  private async resolveTenantVkn(): Promise<string | null> {
    if (this.vknTckn) return this.vknTckn
    if (this.resolvedTenantVkn) return this.resolvedTenantVkn

    // 1) JWT'den keşfet — listeleme yetkisi gerekmez, en güvenilir yol.
    try {
      const discovered = await this.discoverTenantFromToken()
      if (discovered.success && discovered.vknFromToken) {
        this.resolvedTenantVkn = discovered.vknFromToken
        return this.resolvedTenantVkn
      }
    } catch (e) {
      // ignore, fall through to getTenant
    }

    // 2) Fallback: /api/Tenant/getTenant — çoğu müşteri hesabında yetki yok.
    try {
      const token = await this.getToken()
      if (!token) return null
      const res = await fetch(`${this.baseUrl}/api/Tenant/getTenant?limit=50`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      })
      const data = await res.json()
      if (!data?.succeed) {
        console.error("[Mysoft] getTenant failed. raw response:", JSON.stringify(data))
        return null
      }
      const tenants: any[] = Array.isArray(data?.data) ? data.data : []
      const active = tenants.filter((t) => !t.isPassive && typeof t.vknTckn === "string" && t.vknTckn.trim())
      if (active.length === 0) return null
      this.resolvedTenantVkn = String(active[0].vknTckn).trim()
      return this.resolvedTenantVkn
    } catch (error) {
      console.error("[Mysoft] resolveTenantVkn error:", error)
      return null
    }
  }

  /**
   * Mysoft kullanıcısının yetkili olduğu tüm mükellefleri döndürür (Firma Listesi).
   * Swagger v8: GET /api/Tenant/getTenant
   */
  async listTenants(): Promise<{
    success: boolean
    data?: Array<{ tenantName: string; shortName: string; vknTckn: string; isPassive?: boolean }>
    error?: string
  }> {
    try {
      const token = await this.getToken()
      if (!token) return { success: false, error: "Mysoft token alınamadı." }
      const res = await fetch(`${this.baseUrl}/api/Tenant/getTenant?limit=50`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      })
      const data = await res.json()
      if (!data?.succeed) {
        return { success: false, error: data?.message || "Firma listesi alınamadı." }
      }
      return { success: true, data: Array.isArray(data?.data) ? data.data : [] }
    } catch (error: any) {
      return { success: false, error: error?.message || "Bilinmeyen bir hata oluştu." }
    }
  }

  /**
   * Firmanın Mysoft'taki kalan kontör bilgisini döndürür (normalize edilmiş satırlar).
   *
   * Önce "Firma Sayaç Bilgisi" (POST /api/Tenant/getCounterInfo) denenir — normal
   * mükellef hesabının kalan hakkı burada `documentCreditQueryList` altında gelir:
   * kalan = creditQty - usedCreditQty - expiredCreditQty.
   * Boşsa "Firma Kontör Bilgisi" (POST /api/Tenant/getCreditInfo) görünümüne düşülür
   * (genelde İş Ortağı yüklemeleri burada görünür).
   */
  async getCreditInfo(identifierNumber: string): Promise<{
    success: boolean
    source?: string
    data?: Array<{
      remainingCreditQty: number
      creditQty: number
      usedCreditQty: number
      endDate: string | null
      isExpired: boolean
      productLabel: string
    }>
    // Kalan bakiye API'de görünmediğinde (documentCreditQueryList null) gösterilecek
    // tüketim sayaçları — counterByProductList'ten.
    usage?: Array<{ productLabel: string; usedCreditQty: number }>
    error?: string
  }> {
    try {
      const token = await this.getToken()
      if (!token) return { success: false, error: "Mysoft token alınamadı." }
      const authHeaders = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      }

      // 1) Firma Sayaç Bilgisi — mükellef-facing kalan hak + tüketim sayaçları
      const counterRes = await fetch(`${this.baseUrl}/api/Tenant/getCounterInfo`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ identifierNumber }),
      })
      const counterData = await counterRes.json().catch(() => null)
      console.log("[Mysoft] getCounterInfo raw response:", JSON.stringify(counterData))

      // Tüketim sayaçları (her zaman elimizdeyse taşı) — fallback gösterim için.
      const usage: Array<{ productLabel: string; usedCreditQty: number }> = Array.isArray(
        counterData?.data?.counterByProductList,
      )
        ? counterData.data.counterByProductList.map((u: any) => ({
            productLabel: String(u?.productDescription || "Bilinmeyen ürün"),
            usedCreditQty: Number(u?.usedCreditQty) || 0,
          }))
        : []

      const creditList: any[] = Array.isArray(counterData?.data?.documentCreditQueryList)
        ? counterData.data.documentCreditQueryList
        : []
      if (counterData?.succeed && creditList.length > 0) {
        const now = new Date()
        return {
          success: true,
          source: "counter",
          usage,
          data: creditList.map((r) => {
            const credit = Number(r?.creditQty) || 0
            const used = Number(r?.usedCreditQty) || 0
            const expired = Number(r?.expiredCreditQty) || 0
            const remaining = Math.max(0, credit - used - expired)
            const expiry = r?.expiryDate ?? null
            const isExpired = !r?.isNotExpiry && expiry ? new Date(expiry) < now : false
            return {
              remainingCreditQty: remaining,
              creditQty: credit,
              usedCreditQty: used,
              endDate: r?.isNotExpiry ? null : expiry,
              isExpired,
              productLabel: String(
                r?.activationProductTypeDescription || r?.tariffName || "Tüm ürünler",
              ),
            }
          }),
        }
      }

      // 2) Fallback: Firma/İş Ortağı Kontör Bilgisi
      const creditRes = await fetch(`${this.baseUrl}/api/Tenant/getCreditInfo`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ identifierNumber, isGetAllCreditInfo: false }),
      })
      const creditData = await creditRes.json().catch(() => null)
      console.log("[Mysoft] getCreditInfo raw response:", JSON.stringify(creditData))
      if (!counterData?.succeed && !creditData?.succeed) {
        return {
          success: false,
          error: creditData?.message || counterData?.message || "Kontör bilgisi alınamadı.",
        }
      }
      const rows: any[] = Array.isArray(creditData?.data) ? creditData.data : []
      return {
        success: true,
        source: rows.length > 0 ? "credit" : "usage",
        usage,
        data: rows.map((r) => {
          const credit = Number(r?.creditQty) || 0
          const remaining = Number(r?.remainingCreditQty) || 0
          const productTypes: number[] = Array.isArray(r?.productTypeList)
            ? r.productTypeList.map((p: any) => Number(p)).filter((p: number) => Number.isFinite(p))
            : []
          return {
            remainingCreditQty: remaining,
            creditQty: credit,
            usedCreditQty: Math.max(0, credit - remaining),
            endDate: r?.endDate ?? null,
            isExpired: Boolean(r?.isExpired),
            productLabel:
              productTypes.length > 0
                ? productTypes.map((p) => MYSOFT_PRODUCT_LABELS[p] || `Ürün ${p}`).join(", ")
                : "Tüm ürünler",
          }
        }),
      }
    } catch (error: any) {
      return { success: false, error: error?.message || "Bilinmeyen bir hata oluştu." }
    }
  }

  /**
   * İş Ortağı Tarife Listesi (Swagger v8: GET /api/Tenant/getBusinessPartnerTariff).
   * Bu hesapta tarife dönüyorsa → hesabın bayi/İş Ortağı yetkisi var demektir.
   * Normal mükellef hesabında genelde boş/yetkisiz döner.
   */
  async getBusinessPartnerTariff(limit = 50): Promise<{
    success: boolean
    data: any[]
    status: number
    error?: string
    raw?: any
  }> {
    try {
      const token = await this.getToken()
      if (!token) return { success: false, data: [], status: 0, error: "Mysoft token alınamadı." }
      const res = await fetch(
        `${this.baseUrl}/api/Tenant/getBusinessPartnerTariff?limit=${limit}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        },
      )
      const data = await res.json().catch(() => null)
      console.log("[Mysoft] getBusinessPartnerTariff raw:", res.status, JSON.stringify(data))
      return {
        success: Boolean(data?.succeed),
        data: Array.isArray(data?.data) ? data.data : [],
        status: res.status,
        error: data?.succeed ? undefined : data?.message || `HTTP ${res.status}`,
        raw: data,
      }
    } catch (error: any) {
      return { success: false, data: [], status: 0, error: error?.message || "Bilinmeyen hata" }
    }
  }

  /**
   * İş ortağı kontör özet bilgisi (Swagger v8: POST /api/Tenant/getBusinessPartnerDocumentCreditList).
   * businessPartnerQueryType: 1=Ana iş ortağı, 2=Alt iş ortağı. quantityType: 1=Adet.
   * Dönen kayıtlardaki mainBusinessPartnerIdentifierNumber/Name → bu hesabın bağlı olduğu
   * ana iş ortağını (bayiyi) gösterir.
   */
  async getBusinessPartnerDocumentCreditList(
    businessPartnerQueryType: number,
    quantityType = 1,
  ): Promise<{ success: boolean; data: any[]; status: number; error?: string; raw?: any }> {
    try {
      const token = await this.getToken()
      if (!token) return { success: false, data: [], status: 0, error: "Mysoft token alınamadı." }
      const res = await fetch(
        `${this.baseUrl}/api/Tenant/getBusinessPartnerDocumentCreditList`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ businessPartnerQueryType, quantityType }),
        },
      )
      const data = await res.json().catch(() => null)
      console.log(
        `[Mysoft] getBusinessPartnerDocumentCreditList(type=${businessPartnerQueryType}) raw:`,
        res.status,
        JSON.stringify(data),
      )
      return {
        success: Boolean(data?.succeed),
        data: Array.isArray(data?.data) ? data.data : [],
        status: res.status,
        error: data?.succeed ? undefined : data?.message || `HTTP ${res.status}`,
        raw: data,
      }
    } catch (error: any) {
      return { success: false, data: [], status: 0, error: error?.message || "Bilinmeyen hata" }
    }
  }

  /**
   * Firmaya kontör yükleme (Swagger v8: POST /api/Tenant/insertDocumentCredit).
   * Bu İŞ ORTAĞI işlemidir — provider, bayi (İş Ortağı) kimlik bilgileriyle oluşturulmalıdır.
   * identifierNumber = kontörün yükleneceği mükellef VKN/TCKN (bayinin altındaki firma).
   * tariffCode zorunlu (getBusinessPartnerTariff'tan gelir).
   * Başarılıysa Mysoft kayıt id'sini döndürür.
   */
  async loadCredit(params: {
    identifierNumber: string
    tariffCode: string
    creditQty: number
    docDate?: string // YYYY-MM-DD; boşsa bugün
    expiryDate?: string // YYYY-MM-DD; boşsa tarife default'u
    note?: string
  }): Promise<{ success: boolean; creditId?: number; error?: string; raw?: any }> {
    try {
      const token = await this.getToken()
      if (!token) return { success: false, error: "Mysoft token alınamadı." }
      const today = new Date().toISOString().slice(0, 10)
      const body: Record<string, unknown> = {
        identifierNumber: params.identifierNumber,
        tariffCode: params.tariffCode,
        creditQty: params.creditQty,
        docDate: params.docDate || today,
      }
      if (params.expiryDate) body.expiryDate = params.expiryDate
      if (params.note) body.note = params.note

      const res = await fetch(`${this.baseUrl}/api/Tenant/insertDocumentCredit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      console.log("[Mysoft] insertDocumentCredit raw:", res.status, JSON.stringify(data))
      if (!data?.succeed) {
        return {
          success: false,
          error: data?.message || `Kontör yüklenemedi (HTTP ${res.status})`,
          raw: data,
        }
      }
      const creditId =
        typeof data?.data?.id === "number"
          ? data.data.id
          : Number(data?.data?.id) || undefined
      return { success: true, creditId, raw: data }
    } catch (error: any) {
      return { success: false, error: error?.message || "Bilinmeyen hata" }
    }
  }

async sendInvoice(invoiceData: any): Promise<any> {
    try {
      // 1. TOKEN ALMA
      const tokenRes = await fetch(`${this.baseUrl}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          username: this.username,
          password: this.passwordText,
          grant_type: "password"
        })
      });

      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) return { success: false, error: "Mysoft Token alınamadı." };

      // --- KALEM BAZLI HESAPLAMALAR (Mysoft v8) ---
      // Önemli notlar (Swagger v8'den):
      // - KDV satır seviyesinde 'tax' array'ine YAZILMAZ; doğrudan satırın vatRate/amtVatTra/taxableAmtTra alanlarına yazılır.
      //   ('tax' yalnızca ÖİV/ÖTV gibi ek vergiler için.)
      // - İstisna alanları satırın kendisindedir: taxExemptionReasonCode + taxExemptionReasonName
      // - Root 'tax' alanı boş bırakılırsa Mysoft detaylardan otomatik hesaplar — kullanıyoruz.
      const DEFAULT_EXEMPTION_CODE = "351"; // "Diğer İstisnalar" — kullanıcı kod girmediyse son çare
      const DEFAULT_EXEMPTION_REASON = "Vergiden istisna işlem";

      // GİB şematron kuralı: tüm para alanları en fazla 2 ondalık (kuruş) içermeli.
      // Pro-rata payı + KDV hesabında floating-point fazla hane üretebileceğinden
      // gönderim öncesi tüm tutarları 2 ondalığa yuvarlıyoruz.
      const round2 = (n: number) => Math.round(n * 100) / 100;

      // 0 tutarlı kalemleri Mysoft'a göndermiyoruz. Satır iskontosu varsa KDV
      // matrahı (taxableAmtTra) = brüt - iskonto; KDV bu net üzerinden hesaplanır.
      const lineData = (invoiceData.items as any[])
        .map((item: any) => {
          const qty = Number(item.quantity) || 0;
          const unitPrice = Number(item.unitPrice) || 0;
          const vatRate = Number(item.vatRate) || 0;
          const rowTotal = qty * unitPrice; // brüt
          // İskonto tutarı: helper'dan hesaplanmış geliyor. Negatif/aşan değer
          // normalize edilir (brüt üzerinde kalmasın).
          const rawDiscount = Number(item.discountAmount) || 0;
          const lineDiscount = Math.max(0, Math.min(rawDiscount, rowTotal));
          const discountRate = Number(item.discountRate) || 0;
          const exemptionCode = typeof item.taxExemptionReasonCode === "string" && item.taxExemptionReasonCode.trim()
            ? item.taxExemptionReasonCode.trim()
            : null;
          const exemptionReason = typeof item.taxExemptionReason === "string" && item.taxExemptionReason.trim()
            ? item.taxExemptionReason.trim()
            : null;
          // Pro-rata global discount payı sonradan eklenecek.
          return { item, qty, unitPrice, vatRate, rowTotal, lineDiscount, discountRate, exemptionCode, exemptionReason, globalShare: 0, taxable: rowTotal - lineDiscount, rowVat: 0 };
        })
        .filter((l: any) => l.rowTotal > 0);

      // Fatura altı (genel) iskontoyu satırlara PRO-RATA yay. Sebep: Mysoft'un
      // header-level allowanceCharge bilgisi, kullanıcının seçtiği XSLT şablonuna
      // göre GİB görselinde ÖRTÜK kalabiliyor; satır seviyesinde yayılan iskonto
      // ise her UBL XSLT'inde standart olarak render edilir, KDV doğru çıkar.
      const subtotalNetForGlobal = lineData.reduce((s: number, l: any) => s + (l.rowTotal - l.lineDiscount), 0);
      const rawGlobalDiscount = Number(invoiceData.globalDiscountAmount) || 0;
      const appliedGlobalDiscount = subtotalNetForGlobal > 0
        ? Math.max(0, Math.min(rawGlobalDiscount, subtotalNetForGlobal))
        : 0;

      if (appliedGlobalDiscount > 0 && subtotalNetForGlobal > 0) {
        // Yuvarlama hatası birikir — son satırda artığı düzelt.
        let distributed = 0;
        lineData.forEach((l: any, idx: number) => {
          const lineNet = l.rowTotal - l.lineDiscount;
          const isLast = idx === lineData.length - 1;
          const share = isLast
            ? round2(Math.max(0, appliedGlobalDiscount - distributed))
            : round2((lineNet / subtotalNetForGlobal) * appliedGlobalDiscount);
          l.globalShare = share;
          distributed += share;
        });
      }

      // Yeni matrah ve KDV: lineDiscount + globalShare düşülmüş tutar üzerinden.
      // GİB şematron 2-ondalık kuralı için round2() ile yuvarlanır.
      lineData.forEach((l: any) => {
        l.taxable = round2(l.rowTotal - l.lineDiscount - l.globalShare);
        l.rowVat = round2((l.taxable * l.vatRate) / 100);
        l.lineDiscount = round2(l.lineDiscount);
        l.rowTotal = round2(l.rowTotal);
        l.unitPrice = round2(l.unitPrice);
      });

      console.log("[Mysoft] discount distribution →", {
        rawGlobalDiscount,
        appliedGlobalDiscount,
        subtotalNetForGlobal,
        lines: lineData.map((l: any) => ({
          desc: l.item.description,
          rowTotal: l.rowTotal,
          lineDiscount: l.lineDiscount,
          globalShare: l.globalShare,
          taxable: l.taxable,
          rowVat: l.rowVat,
        })),
      });

      if (lineData.length === 0) {
        return { success: false, error: "Faturada sıfır tutarsız kalem bulunamadı (tüm kalemler 0)." };
      }

      const isoDate = invoiceData.date instanceof Date ? invoiceData.date.toISOString() : new Date(invoiceData.date).toISOString();

      // İstisnalı (vatRate=0 + exemption kodu olan) en az bir kalem varsa Mysoft'un
      // şematron kuralı gereği invoiceType=ISTISNA olmalı (SATIS reddedilir).
      const hasExemption = lineData.some((l: any) => l.vatRate === 0 && l.exemptionCode);
      const resolvedInvoiceType = hasExemption ? "ISTISNA" : "SATIS";

      // Belge tipi: invoiceData.invoiceType = "E_INVOICE" → e-Fatura, "E_ARCHIVE" → e-Arşiv
      // Default e-Arşiv (gerçek kişi müşteri); açıkça E_INVOICE belirtildiyse e-Fatura.
      const isEFatura = invoiceData.invoiceType === "E_INVOICE"
      const eDocumentType = isEFatura ? "EFATURA" : "EARSIVFATURA"
      // Profile: E-Fatura için iki seçenek var: TEMELFATURA (alıcı yanıtı beklemez)
      // ve TICARIFATURA (alıcı yanıtı bekler). Bazı Mysoft tenant'larında numaratör
      // sadece TEMELFATURA için tanımlı; TICARIFATURA gönderirsek "00018 uygun
      // numaratör bulunamadı" döner. Stratejimiz: önce TICARIFATURA dene, 00018
      // alırsak TEMELFATURA'ya düş ve aynı payload'ı tekrar gönder.
      // Kullanıcı önizleme ekranında Ticari/Temel seçtiyse onu baz al; aksi halde
      // TICARIFATURA ile başla (00018 fallback'i yine TEMELFATURA'ya düşürür).
      const initialProfile = isEFatura
        ? (invoiceData.eInvoiceProfile === "TEMELFATURA" ? "TEMELFATURA" : "TICARIFATURA")
        : "EARSIVFATURA"
      let profile = initialProfile

      // Alıcı VKN/TCKN ön doğrulaması:
      //  - Eksik veya format hatalı (10/11 haneden farklı, rakam değil) → her iki belge tipi için blokla.
      //  - Tüm rakamları aynı placeholder (11111111111, 22222222222 vb.) → yalnızca E-Fatura için blokla.
      //    E-Arşiv senaryosunda 11111111111 "Final Tüketici" için yaygın kullanılır ve Mysoft kabul eder.
      //  - E-Fatura'da placeholder bloklanır çünkü Mysoft "fatura pk bilgisi bulunamadı" döndürür.
      const rawVkn = typeof invoiceData.customer?.taxNumber === "string"
        ? invoiceData.customer.taxNumber.trim()
        : ""
      const hasBadFormat = !rawVkn || !/^\d{10,11}$/.test(rawVkn)
      const isPlaceholderVkn = !hasBadFormat && /^(\d)\1+$/.test(rawVkn)
      if (hasBadFormat) {
        const display = rawVkn || "(boş)"
        return {
          success: false,
          error: `Müşterinin VKN/TCKN'si geçerli görünmüyor: "${display}". Müşteri kartındaki Vergi Numarası alanını gerçek bir VKN (10 haneli) veya TCKN (11 haneli) ile güncelleyin.`,
        }
      }
      if (isEFatura && isPlaceholderVkn) {
        return {
          success: false,
          error: `Müşterinin VKN'si placeholder/test değeri ("${rawVkn}"). E-Fatura için alıcının GİB'de kayıtlı gerçek bir mükellef olması gerekir. Müşteri kartındaki Vergi Numarası'nı gerçek değerle güncelleyin ya da bu fatura için E-Arşiv kullanın.`,
        }
      }

      // Prefix çözümleme:
      //  1) Kullanıcı (Kobipo settings → eFatura/eArchive prefix) açıkça verdiyse onu kullan
      //  2) Yoksa Mysoft'taki VARSAYILAN numaratörü kullan — belge tipine (E-Fatura/E-Arşiv)
      //     göre isDefault olan numaratörü seçeriz. Böylece kullanıcı Kobipo'da prefix
      //     seçip kaydetmek zorunda kalmaz; Mysoft'taki varsayılan otomatik kullanılır.
      //  3) O da bulunamazsa örnek payload (createInvoiceOutboxTestJson) prefix'ine düş.
      const explicitPrefix = typeof invoiceData.prefix === "string" && invoiceData.prefix.trim()
        ? invoiceData.prefix.trim().toUpperCase()
        : null
      let resolvedPrefix = explicitPrefix

      if (!resolvedPrefix) {
        // 2) Mysoft varsayılan numaratörü (belge tipine göre)
        try {
          const nums = await this.listNumerators()
          if (nums.success && Array.isArray(nums.data)) {
            const matchesType = (n: { edocumentType: string }) => {
              const t = String(n.edocumentType || "").toUpperCase()
              return isEFatura
                ? t === "1" || t === "EFATURA"
                : t === "2" || t === "10" || t === "EARSIVFATURA" || t === "GIBEARSIVFATURA"
            }
            const candidates = nums.data.filter((n) => !n.isPassive && matchesType(n))
            const chosen = candidates.find((n) => n.isDefault) || candidates[0]
            if (chosen?.prefix?.trim()) {
              resolvedPrefix = chosen.prefix.trim().toUpperCase()
            }
          }
        } catch {
          // listNumerators başarısızsa aşağıdaki örnek payload fallback'ine düş
        }
      }

      if (!resolvedPrefix) {
        // 3) Fallback: örnek payload prefix'i
        const sample = await this.getSampleInvoicePayload()
        const payload =
          sample.rawResponse?.data && typeof sample.rawResponse.data === "object"
            ? sample.rawResponse.data
            : sample.rawResponse
        const samplePrefix =
          typeof payload?.prefix === "string" && payload.prefix.trim()
            ? payload.prefix.trim().toUpperCase()
            : null
        if (samplePrefix) {
          resolvedPrefix = samplePrefix
        } else {
          return {
            success: false,
            error:
              (isEFatura
                ? "E-Fatura için prefix tanımlı değil. "
                : "E-Arşiv için prefix tanımlı değil. ") +
              "Seri No Tanımları sayfasından 'Mysoft'tan Çek' butonuna basın veya prefix'i manuel girin.",
          }
        }
      }

      // 2. MYSOFT v8 PAYLOAD
      // ETTN: belgeyi pre-tracking için kendimiz üretiyoruz. Mysoft hem accept edip
      // bunu kullanır hem de yanıtta aynı GUID'i invoiceETTN olarak döner.
      const generatedEttn =
        typeof (globalThis as any).crypto?.randomUUID === "function"
          ? (globalThis as any).crypto.randomUUID()
          : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-4${Math.random()
              .toString(16)
              .slice(2, 5)}-${Math.random().toString(16).slice(2, 5)}-${Math.random()
              .toString(16)
              .slice(2, 14)}`

      // Mükellef VKN/TCKN: yalnızca E-Dönüşüm Ayarları'nda DOĞRULANMIŞ olarak
      // kayıtlı tenant VKN'sini kullan (invoiceData.tenantIdentifierNumber).
      // sender.taxNumber'a (= Kobipo firma VKN'si) fallback ETME — Mysoft API
      // kullanıcısının tenant VKN'si Kobipo firma VKN'sinden farklı olabilir,
      // yanlış değer Mysoft'tan "firma kullanıcı kaydı bulunamadı" döndürür.
      // Boş bırakırsak Mysoft login kullanıcısının varsayılan tenant'ını kullanır.
      const tenantId =
        (typeof invoiceData.tenantIdentifierNumber === "string" && invoiceData.tenantIdentifierNumber.trim()) ||
        ""

      const payload: any = {
        "id": 0,
        // Mysoft'un hesabımızı tanıdığı GUID — discover-mysoft-config'den geliyor.
        // YOK ise Mysoft "uygun numaratör bulunamadı" der. Boş bırakma:
        ...(invoiceData.connectorGuid ? { connectorGuid: invoiceData.connectorGuid } : {}),
        "eDocumentType": eDocumentType,
        "profile": profile,
        "invoiceType": resolvedInvoiceType,
        "ettn": generatedEttn,
        "prefix": resolvedPrefix,
        "docNo": "",
        "docDate": isoDate,
        "docTime": isoDate,
        "currencyCode": "TRY",
        "currencyRate": 1.0,
        "senderType": "ELEKTRONIK",
        // Gönderici posta kutusu etiketleri — keşifte aldığımız değerler.
        ...(invoiceData.pkAlias ? { pkAlias: invoiceData.pkAlias } : {}),
        ...(invoiceData.gbAlias ? { gbAlias: invoiceData.gbAlias } : {}),
        // Birden fazla mükellefi olan connector için zorunlu; tek mükellefli ise empty.
        "tenantIdentifierNumber": tenantId,
        "numeratorSetCode": null,
        "xsltSetCode": null,
        // Kullanıcının Belge Şablonları ekranından seçtiği aktif dizayn (varsa).
        // Boşsa Mysoft varsayılan/genel dizaynı kullanır (alttaki bayrak).
        ...(invoiceData.xsltName ? { xsltName: invoiceData.xsltName } : {}),
        // Firmaya özel/varsayılan onaylı dizayn yoksa Mysoft'un genel dizaynıyla gönder.
        // Bu olmadan E-Arşiv'de "belge görseli bulunamadı" hatası alınıyor (E-Fatura'da
        // GİB standart dizaynı devreye girdiği için sorun çıkmıyordu). Kullanıcı kendi
        // şablonunu Belge Şablonları ekranından yüklerse o kullanılır.
        "isSendWithGeneralXsltIfDefaultNotExists": true,
        "isManuelCalculation": false,
        // Fatura not/açıklama alanı (UBL cbc:Note). Mysoft NoteModel listesi bekler;
        // boşsa hiç gönderme. Hem e-Fatura hem e-Arşiv'de belgede görünür.
        ...(typeof invoiceData.notes === "string" && invoiceData.notes.trim()
          ? { notes: [{ note: invoiceData.notes.trim() }] }
          : {}),

        "invoiceAccount": {
            "accountName": invoiceData.customer?.name || "Son Kullanıcı",
            "vknTckn": rawVkn,
            "taxOfficeName": invoiceData.customer?.taxOffice || "Vergi Dairesi",
            "countryName": "TÜRKİYE",
            "cityName": invoiceData.customer?.city || "DENİZLİ",
            // İlçe: carinin gerçek ilçe bilgisi. Girilmemişse il'e geri düşeriz
            // (Mysoft boş citySubdivision'ı reddedebiliyor) — sabit ilçe ASLA yazma.
            "citySubdivision": invoiceData.customer?.district || invoiceData.customer?.city || "DENİZLİ",
            "streetName": invoiceData.customer?.address || "-",
            "buildingNumber": "1"
        },

        "invoiceDetail": lineData.map((l: any) => {
            const detail: any = {
                productCode: l.item.productId || "URUN",
                productName: l.item.description || "Muhtelif Ürün/Hizmet",
                unitCode: "C62",
                qty: l.qty,
                unitPriceTra: l.unitPrice,
                amtTra: l.rowTotal,        // brüt (qty * unitPrice)
                taxableAmtTra: l.taxable,  // matrah (brüt - satır iskonto - global pay)
                vatRate: l.vatRate,
                amtVatTra: l.rowVat,       // matrah * vatRate / 100
            };
            // İskonto satırları (UBL cac:AllowanceCharge, chargeIndicator=false).
            // Satır iskontosu + (varsa) fatura altı iskontodan o satıra düşen pay
            // ayrı entry'ler olarak gönderilir; tüm UBL XSLT'leri bunları render eder.
            const allowanceEntries: any[] = [];
            if (l.lineDiscount > 0) {
              allowanceEntries.push({
                chargeIndicator: false,
                multiplierFactorNumeric:
                  l.discountRate > 0 ? l.discountRate / 100 : (l.rowTotal > 0 ? l.lineDiscount / l.rowTotal : 0),
                amount: l.lineDiscount,
                baseAmount: l.rowTotal,
                allowanceChargeReason: "Satır İskontosu",
              });
            }
            if (l.globalShare > 0) {
              const baseForGlobal = l.rowTotal - l.lineDiscount;
              allowanceEntries.push({
                chargeIndicator: false,
                multiplierFactorNumeric: baseForGlobal > 0 ? l.globalShare / baseForGlobal : 0,
                amount: l.globalShare,
                baseAmount: baseForGlobal,
                allowanceChargeReason: "Fatura İskontosu",
              });
            }
            if (allowanceEntries.length > 0) {
              detail.allowanceCharge = allowanceEntries;
            }
            if (l.vatRate === 0) {
                detail.taxExemptionReasonCode = l.exemptionCode || DEFAULT_EXEMPTION_CODE;
                detail.taxExemptionReasonName = l.exemptionReason || DEFAULT_EXEMPTION_REASON;
            }
            return detail;
        })
      };


      // 3. MYSOFT'A GÖNDER (profile fallback ile)
      const sendOnce = async (currentPayload: any) => {
        console.log("[Mysoft] sendInvoice payload →", JSON.stringify(currentPayload, null, 2))
        const res = await fetch(`${this.baseUrl}/api/InvoiceOutbox/invoiceOutbox`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(currentPayload),
        });
        const r = await res.json();
        console.log("[Mysoft] sendInvoice response ←", JSON.stringify(r, null, 2))
        return r;
      };

      let result = await sendOnce(payload);

      // E-Fatura için 00018 ("uygun numaratör bulunamadı") gelirse TEMELFATURA
      // profile'ı ile bir kez daha dene. Bazı Mysoft tenant'ları numaratörü sadece
      // TEMELFATURA için tanımlamış oluyor — TICARIFATURA reddediliyor.
      if (
        !result?.succeed &&
        isEFatura &&
        result?.errorCode === "00018" &&
        profile === "TICARIFATURA"
      ) {
        profile = "TEMELFATURA";
        payload.profile = profile;
        console.log("[Mysoft] 00018 alındı, TEMELFATURA ile retry deneniyor…")
        result = await sendOnce(payload);
      }

      if (!result.succeed) return { success: false, error: result.message };

      // Mysoft v8 normalde data.invoiceETTN döner; sürüm farklılıklarına karşı
      // farklı isim varyasyonlarını da kontrol et. Hiçbirinden çıkmazsa kendi
      // ürettiğimiz ETTN'e fallback yap (Mysoft kabul ettiyse aynı GUID kullanılıyor).
      const data = (result && typeof result.data === "object" && result.data !== null) ? result.data : result;
      const rawUuid: unknown =
        data?.invoiceETTN ??
        data?.invoiceEttn ??
        data?.invoiceUUID ??
        data?.invoiceUuid ??
        data?.ettn ??
        data?.uuid ??
        generatedEttn;

      const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (typeof rawUuid !== "string" || !guidRegex.test(rawUuid)) {
        console.error("[Mysoft] sendInvoice: geçerli GUID dönmedi. Raw response:", JSON.stringify(result));
        return {
          success: false,
          error:
            "Mysoft fatura kabul etti ancak yanıtta geçerli ETTN (GUID) bulunamadı. Sunucu logundan ham yanıtı kontrol edin.",
        };
      }

      // Mysoft, prefix'e göre resmi belge numarasını (docNo) atar; yanıtta gelirse
      // yakala (boş "" gelebilir — o durumda durum sorgusunda doldurulur).
      const rawDocNo = data?.docNo ?? data?.documentNo ?? data?.invoiceNo;
      const docNo = typeof rawDocNo === "string" && rawDocNo.trim() ? rawDocNo.trim() : undefined;

      return { success: true, uuid: rawUuid, docNo };

    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async getInvoiceStatus(uuid: string): Promise<any> {
    try {
      const tokenRes = await fetch(`${this.baseUrl}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          username: this.username,
          password: this.passwordText,
          grant_type: "password"
        })
      });

      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) return { success: false, error: "Token alınamadı" };

      // Swagger v8: GET /api/InvoiceOutbox/getInvoiceOutboxStatus?invoiceETTN={uuid}
      const statusRes = await fetch(`${this.baseUrl}/api/InvoiceOutbox/getInvoiceOutboxStatus?invoiceETTN=${encodeURIComponent(uuid)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json'
        }
      });

      const result = await statusRes.json();

      if (!result.succeed) {
         return { success: false, error: result.message || "Durum sorgulanamadı." };
      }

      // Mysoft invoiceStatusText değerleri:
      // BOS, IPTAL_EDILDI, TASLAK, ARSIV_KAYIT_KUYRUGUNDA, GIBE_GONDERILECEK,
      // GIBE_GONDERILDI, ALICIYA_ULASTI, KABUL_KUYRUGUNDA, RED_KUYRUGUNDA,
      // YANIT_BEKLENIYOR, KABUL, RED, HATA, ONAYLANDI(e-Arşiv için)
      const rawText: string = result.data?.invoiceStatusText || "";
      const declineReason: string | undefined = result.data?.declineReason || undefined;
      const envelopeStatusText: string | undefined = result.data?.envelopeStatusText || undefined;
      // Mysoft'un prefix ile atadığı resmi belge numarası (Fatura Numarası).
      const rawDocNo: unknown = result.data?.docNo;
      const docNo: string | undefined =
        typeof rawDocNo === "string" && rawDocNo.trim() ? rawDocNo.trim() : undefined;

      // İç sistem statüsü ve insan-okunabilir mesaj
      let mappedStatus: "APPROVED" | "REJECTED" | "CANCELLED" | "PROCESSING" | "DRAFT" = "PROCESSING";
      const upper = rawText.toUpperCase();
      if (upper === "ONAYLANDI" || upper === "KABUL" || upper === "ALICIYA_ULASTI") mappedStatus = "APPROVED";
      else if (upper === "RED" || upper === "HATA") mappedStatus = "REJECTED";
      else if (upper === "IPTAL_EDILDI") mappedStatus = "CANCELLED";
      else if (upper === "TASLAK") mappedStatus = "DRAFT";

      const humanLabel: Record<string, string> = {
        BOS: "Henüz işlem yok",
        IPTAL_EDILDI: "İptal edildi",
        TASLAK: "Taslak",
        ARSIV_KAYIT_KUYRUGUNDA: "Arşiv kayıt kuyruğunda",
        GIBE_GONDERILECEK: "GİB'e gönderilecek",
        GIBE_GONDERILDI: "GİB'e gönderildi",
        ALICIYA_ULASTI: "Alıcıya ulaştı",
        KABUL_KUYRUGUNDA: "Kabul kuyruğunda",
        RED_KUYRUGUNDA: "Red kuyruğunda",
        YANIT_BEKLENIYOR: "Yanıt bekleniyor",
        KABUL: "Kabul edildi",
        RED: "Reddedildi",
        HATA: "Hata",
        ONAYLANDI: "Onaylandı",
      };

      const message =
        declineReason ||
        humanLabel[upper] ||
        envelopeStatusText ||
        rawText ||
        "Durum bilgisi alındı";

      return {
        success: true,
        status: mappedStatus,
        rawText,
        message,
        declineReason,
        docNo,
      };

    } catch (error: any) {
      return { success: false, error: error.message || "Bilinmeyen bir hata oluştu." };
    }
  }

  /**
   * EInvoiceProvider interface uyumu için stub — gerçek listeleme
   * listIncomingInvoices() üzerinden yapılır (zengin tip + raw response).
   */
  async getIncomingInvoices(_params: any): Promise<any[]> {
    return []
  }

  /**
   * Mysoft'tan gelen (alıcı tarafa düşen) e-faturaları çeker.
   *
   * Swagger v8: POST /api/InvoiceInbox/getInvoiceInboxWithHeaderInfoListForPeriod
   * Header info'lu varyantı seçtik — döküman özet bilgileri (gönderici VKN, isim,
   * tutarlar, tarih, vs.) item içinde bir kerede gelir. Diğer alternatif paging'li
   * versiyon (...ForPeriodPaging) — şimdilik ihtiyaç yok.
   *
   * Bu metod DB'ye yazmaz, yalnızca ham veriyi mapper'dan geçirir. Test hesabında
   * inbox boş olabilir — { success: true, data: [] } dönmesi normaldir.
   */
  async listIncomingInvoices(params: {
    startDate?: Date
    endDate?: Date
    raw?: boolean
  } = {}): Promise<
    | {
        success: true
        data: Array<{
          uuid: string
          invoiceNo: string | null
          date: string | null
          totalAmount: number | null
          taxExclusiveAmount: number | null
          taxInclusiveAmount: number | null
          vatAmount: number | null
          netAmount: number | null
          currency: string | null
          currencyRate: number | null
          status: string | null
          invoiceType: string | null
          profile: string | null
          envelopeStatusCode: string | null
          envelopeStatusDesc: string | null
          isArchived: boolean
          sender: { name: string | null; taxNumber: string | null }
          raw: Record<string, any>
        }>
        rawResponse?: any
      }
    | { success: false; error: string; rawResponse?: any }
  > {
    try {
      const token = await this.getToken()
      if (!token) return { success: false, error: "Mysoft token alınamadı." }

      const end = params.endDate || new Date()
      const start = params.startDate || new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000)

      const url = `${this.baseUrl}/api/InvoiceInbox/getInvoiceInboxWithHeaderInfoListForPeriod`
      const body = {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      }

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })

      const result = await res.json().catch(() => null)
      if (!result || result.succeed === false) {
        return {
          success: false,
          error: result?.message || `HTTP ${res.status}`,
          rawResponse: result,
        }
      }

      const items: any[] = Array.isArray(result.data)
        ? result.data
        : Array.isArray(result.data?.items)
        ? result.data.items
        : []

      // Defensive mapping — Mysoft'un farklı sürümlerinde alan isimleri değişebiliyor.
      // Yaygın olası isimlerin hepsini deniyor, ilk dolu olanı kullanıyoruz. Ham JSON
      // ayrıca raw alanında saklanıyor (debug için).
      const pick = (obj: any, ...keys: string[]): any => {
        for (const k of keys) {
          if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k]
        }
        return null
      }
      const num = (v: any): number | null => {
        if (v === null || v === undefined || v === "") return null
        const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v)
        return Number.isFinite(n) ? n : null
      }

      // Gerçek Mysoft InvoiceInbox şemasına göre mapping (v8 test ortamından doğrulandı):
      //  - Gönderici VKN: root.vknTckn (nested sender objesi YOK)
      //  - Gönderici İsim: root.accountName
      //  - UUID: root.ettn (outbox'taki invoiceETTN değil — sadece "ettn")
      //  - Toplam: root.payableAmount, KDV: root.taxTotalTra
      //  - Net (KDV hariç): root.taxExclusiveAmount, Brüt: root.taxInclusiveAmount
      const mapped = items.map((item: any) => ({
        uuid: String(pick(item, "ettn", "invoiceETTN", "invoiceEttn", "uuid") ?? ""),
        invoiceNo: pick(item, "docNo", "documentNo", "invoiceNo") as string | null,
        date: pick(item, "docDate", "documentDate", "invoiceDate", "issueDate") as string | null,
        totalAmount: num(pick(item, "payableAmount", "payableAmountTra", "totalAmount")),
        taxExclusiveAmount: num(pick(item, "taxExclusiveAmount", "amtTra", "netAmount")),
        taxInclusiveAmount: num(pick(item, "taxInclusiveAmount")),
        vatAmount: num(pick(item, "taxTotalTra", "amtVatTra", "vatAmount", "totalVatAmount")),
        netAmount: num(pick(item, "taxExclusiveAmount", "lineExtensionAmount", "netAmount")),
        currency: pick(item, "currencyCode", "currency") as string | null,
        currencyRate: num(pick(item, "currencyRate")),
        status: pick(item, "invoiceStatusText", "envelopeStatusText", "status") as string | null,
        invoiceType: pick(item, "invoiceType") as string | null,
        profile: pick(item, "profile") as string | null,
        envelopeStatusCode: pick(item, "envelopeStatusCode") as string | null,
        envelopeStatusDesc: pick(item, "envelopeStatusDesc") as string | null,
        isArchived: Boolean(pick(item, "isArchived")),
        sender: {
          name: pick(item, "accountName", "senderName", "senderTitle") as string | null,
          taxNumber: pick(
            item,
            "vknTckn",
            "senderVknTckn",
            "senderVkn",
            "senderTaxNumber",
          ) as string | null,
        },
        raw: item,
      }))

      return {
        success: true,
        data: mapped,
        rawResponse: params.raw ? result : undefined,
      }
    } catch (error: any) {
      return { success: false, error: error?.message || "Bilinmeyen hata" }
    }
  }

  private async getToken(): Promise<string | null> {
    try {
      const tokenRes = await fetch(`${this.baseUrl}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          username: this.username,
          password: this.passwordText,
          grant_type: "password",
        }),
      });
      const tokenData = await tokenRes.json().catch(() => ({}));
      if (!tokenData?.access_token) {
        // Şifreyi ASLA loglama. Yalnızca Mysoft'un dönüş bilgisi + ortam/host
        // bilgisi loglanır — Vercel loglarından gerçek nedeni görmek için.
        console.error("[Mysoft] getToken: access_token yok.", {
          baseUrl: this.baseUrl,
          httpStatus: tokenRes.status,
          error: tokenData?.error ?? null,
          errorDescription: tokenData?.error_description ?? tokenData?.message ?? null,
        });
        return null;
      }
      return tokenData.access_token;
    } catch (error: any) {
      console.error("[Mysoft] getToken: istek başarısız (ağ/TLS?).", {
        baseUrl: this.baseUrl,
        message: error?.message ?? String(error),
      });
      return null;
    }
  }

  /**
   * Mysoft'un sizin hesabınız için kabul edeceği örnek bir fatura payload'ını döndürür.
   * Resmi Postman koleksiyonundaki endpoint — Mysoft müşteri API'sinde `/api/Tenant/*`
   * bulunmadığı için PREFIX/CONNECTOR_GUID/ALIAS gibi hesaba özel değerleri keşfetmenin
   * tek doğru yolu burası. Hesabın yetkili olduğu prefix doğrudan yanıttaki `prefix`
   * alanında gelir.
   */
  async getSampleInvoicePayload(): Promise<{
    success: boolean
    rawResponse?: any
    error?: string
  }> {
    try {
      const token = await this.getToken()
      if (!token) return { success: false, error: "Mysoft token alınamadı." }
      const res = await fetch(`${this.baseUrl}/api/InvoiceOutbox/createInvoiceOutboxTestJson`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      })
      const raw = await res.json()
      if (!res.ok || raw?.succeed === false) {
        return { success: false, error: raw?.message || `HTTP ${res.status}`, rawResponse: raw }
      }
      return { success: true, rawResponse: raw }
    } catch (error: any) {
      return { success: false, error: error?.message || "Bilinmeyen hata" }
    }
  }

  /**
   * Mysoft OAuth token'ından (JWT) tenant VKN'sini ve diğer kullanıcı bilgilerini
   * çözümler. Token base64url-encoded JSON payload taşır; içinden VKN-benzeri
   * (10 veya 11 hane, tek karakter tekrarı değil) ilk değeri yakalar.
   *
   * Common Mysoft JWT claim isimleri (sürüm/sürüm değişir):
   *   vkn, tckn, vknTckn, identifier, tenantIdentifierNumber, tenant_identifier_number,
   *   identifier_number, sub, mukellefVkn
   *
   * Listeleme/getTenant yetkisi olmayan müşteri hesapları için TEK güvenilir
   * keşif yolu — Mysoft bizi token'da kendi kullanıcısına bağlı tenant'la
   * birlikte tanıtıyor.
   */
  async discoverTenantFromToken(): Promise<{
    success: boolean
    vknFromToken?: string
    candidateValues?: Array<{ key: string; value: string }>
    allClaims?: Record<string, unknown>
    error?: string
  }> {
    try {
      const token = await this.getToken()
      if (!token) return { success: false, error: "Mysoft token alınamadı (kullanıcı adı/şifre hatalı olabilir)." }

      const parts = token.split(".")
      if (parts.length !== 3) {
        return {
          success: false,
          error: "Mysoft opaque token döndü (JWT değil) — token'dan VKN okunamıyor.",
        }
      }
      let payloadJson: Record<string, unknown>
      try {
        const padded = parts[1] + "=".repeat((4 - (parts[1].length % 4)) % 4)
        const decoded = Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8")
        payloadJson = JSON.parse(decoded)
      } catch (e: any) {
        return { success: false, error: `JWT payload parse edilemedi: ${e?.message || ""}` }
      }

      // Tüm primitive değerleri flat olarak topla (nested objelerin de bir seviyesi)
      const flat: Array<{ key: string; value: string }> = []
      const addPair = (key: string, value: unknown) => {
        if (typeof value === "string" || typeof value === "number") {
          flat.push({ key, value: String(value) })
        }
      }
      for (const [key, value] of Object.entries(payloadJson)) {
        if (value !== null && typeof value === "object" && !Array.isArray(value)) {
          for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
            addPair(`${key}.${subKey}`, subValue)
          }
        } else if (Array.isArray(value)) {
          value.forEach((v, i) => addPair(`${key}[${i}]`, v))
        } else {
          addPair(key, value)
        }
      }

      // VKN/TCKN adayları: 10 veya 11 haneli rakam, tüm rakamlar aynı değil.
      const vknRegex = /^\d{10,11}$/
      const candidates = flat.filter((p) => vknRegex.test(p.value) && !/^(\d)\1+$/.test(p.value))

      // Tenant/VKN ile ilgili isimleri öncelikle değerlendir.
      const keyScore = (k: string): number => {
        const lk = k.toLowerCase()
        if (lk.includes("vkn") || lk.includes("tckn")) return 100
        if (lk.includes("tenant") && lk.includes("identifier")) return 95
        if (lk.includes("identifier_number") || lk.includes("identifiernumber")) return 90
        if (lk.includes("tenant")) return 50
        if (lk.includes("identifier")) return 40
        if (lk.includes("mukellef")) return 35
        if (lk === "sub") return 5
        return 1
      }
      candidates.sort((a, b) => keyScore(b.key) - keyScore(a.key))

      const vknFromToken = candidates.length > 0 ? candidates[0].value : undefined
      if (vknFromToken) {
        this.resolvedTenantVkn = vknFromToken
      }
      return {
        success: true,
        vknFromToken,
        candidateValues: candidates,
        allClaims: payloadJson,
      }
    } catch (error: any) {
      return { success: false, error: error?.message || "Token keşfi sırasında bilinmeyen hata." }
    }
  }

  async cancelInvoice(uuid: string, options?: { cancelType?: string; cancelNote?: string; cancelDate?: string }): Promise<any> {
    try {
      const token = await this.getToken();
      if (!token) return { success: false, error: "Mysoft token alınamadı." };

      // Swagger v8: GET /api/InvoiceOutbox/cancelEArchiveInvoice
      // cancelType: GIB | NOTER | KEP | TAAHHUTLUMEKTUP | PORTAL
      const cancelType = options?.cancelType || "PORTAL";
      const cancelNote = options?.cancelNote || "Kullanıcı tarafından iptal edildi";
      const cancelDate = options?.cancelDate || new Date().toISOString();

      const url = new URL(`${this.baseUrl}/api/InvoiceOutbox/cancelEArchiveInvoice`);
      url.searchParams.set("invoiceETTN", uuid);
      url.searchParams.set("cancelDate", cancelDate);
      url.searchParams.set("cancelType", cancelType);
      url.searchParams.set("cancelNote", cancelNote);

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      const result = await res.json();
      if (!result?.succeed) {
        return { success: false, error: result?.message || "İptal başarısız." };
      }
      return { success: true, message: result?.message || "Fatura iptal edildi." };
    } catch (error: any) {
      return { success: false, error: error?.message || "Bilinmeyen bir hata oluştu." };
    }
  }

  /**
   * Gelen TİCARİ faturayı KABUL eder (GİB'e kabul yanıtı gönderir).
   * Swagger v8: GET /api/InvoiceInbox/acceptInvoice?invoiceETTN=...&tenantIdentifierNumber=...
   * Sadece TICARIFATURA için anlamlıdır; temel/e-arşiv yanıt beklemez.
   */
  async acceptIncomingInvoice(
    uuid: string,
  ): Promise<{ success: boolean; error?: string; message?: string }> {
    try {
      const token = await this.getToken();
      if (!token) return { success: false, error: "Mysoft token alınamadı." };

      const url = new URL(`${this.baseUrl}/api/InvoiceInbox/acceptInvoice`);
      url.searchParams.set("invoiceETTN", uuid);
      const acceptTenant = await this.resolveTenantVkn();
      if (acceptTenant) url.searchParams.set("tenantIdentifierNumber", acceptTenant);

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const result = await res.json().catch(() => null);
      if (!result || result.succeed === false) {
        return { success: false, error: result?.message || `Kabul başarısız (HTTP ${res.status}).` };
      }
      return { success: true, message: result?.message || "Fatura kabul edildi." };
    } catch (error: any) {
      return { success: false, error: error?.message || "Bilinmeyen bir hata oluştu." };
    }
  }

  /**
   * Gelen TİCARİ faturayı REDDEDER (GİB'e red yanıtı gönderir).
   * Swagger v8: GET /api/InvoiceInbox/denyInvoice?invoiceETTN=...&rejectReason=...&tenantIdentifierNumber=...
   */
  async rejectIncomingInvoice(
    uuid: string,
    rejectReason: string,
  ): Promise<{ success: boolean; error?: string; message?: string }> {
    try {
      const token = await this.getToken();
      if (!token) return { success: false, error: "Mysoft token alınamadı." };

      const url = new URL(`${this.baseUrl}/api/InvoiceInbox/denyInvoice`);
      url.searchParams.set("invoiceETTN", uuid);
      url.searchParams.set("rejectReason", rejectReason || "Red");
      const denyTenant = await this.resolveTenantVkn();
      if (denyTenant) url.searchParams.set("tenantIdentifierNumber", denyTenant);

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const result = await res.json().catch(() => null);
      if (!result || result.succeed === false) {
        return { success: false, error: result?.message || `Red başarısız (HTTP ${res.status}).` };
      }
      return { success: true, message: result?.message || "Fatura reddedildi." };
    } catch (error: any) {
      return { success: false, error: error?.message || "Bilinmeyen bir hata oluştu." };
    }
  }

  /**
   * Bir VKN/TCKN için GİB hesap modelini sorgular.
   *
   * Swagger v8: GET /api/GeneralCard/getGibAccountModel?vknTckn={vkn}
   *
   * Dönen modelin `eInvoiceStartDate`'i null değil ve bugünden eski ise alıcı
   * **E-Fatura mükellefi** olarak GİB'de kayıtlı demektir. Bu durumda E-Arşiv
   * gönderilemez — Mysoft "E-Fatura için Profile alanında geçersiz değer"
   * hatasıyla reddeder. Kullanıcı E-Arşiv seçtiyse otomatik olarak E-Fatura'ya
   * çevirmek için bu metodu çağırıyoruz.
   */
  async getGibAccount(vknTckn: string): Promise<
    | {
        success: true
        data: {
          identifierNumber: string | null
          accountName: string | null
          eInvoiceStartDate: string | null
          eWaybillStartDate: string | null
          isPassive: boolean
          isEInvoiceTaxpayer: boolean
          raw: any
        } | null
      }
    | { success: false; error: string }
  > {
    try {
      const cleaned = String(vknTckn || "").replace(/\D/g, "")
      if (!cleaned || !/^\d{10,11}$/.test(cleaned)) {
        return { success: false, error: "Geçersiz VKN/TCKN format" }
      }
      const token = await this.getToken()
      if (!token) return { success: false, error: "Mysoft token alınamadı." }

      const url = new URL(`${this.baseUrl}/api/GeneralCard/getGibAccountModel`)
      url.searchParams.set("vknTckn", cleaned)

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      })

      const result = await res.json().catch(() => null)
      if (!result || result.succeed === false) {
        // Mysoft hesabı bulamazsa data null döner ama succeed=true olur.
        // Açık fail varsa hata mesajı dön.
        if (result?.message) {
          return { success: false, error: result.message }
        }
        return { success: true, data: null }
      }

      const model: any = result.data
      if (!model || typeof model !== "object") {
        return { success: true, data: null }
      }

      const eInvoiceStartDate: string | null = model.eInvoiceStartDate || null
      const isPassive: boolean = Boolean(model.isPassive)
      const today = new Date()
      const isEInvoiceTaxpayer =
        !isPassive &&
        !!eInvoiceStartDate &&
        !Number.isNaN(new Date(eInvoiceStartDate).getTime()) &&
        new Date(eInvoiceStartDate).getTime() <= today.getTime()

      return {
        success: true,
        data: {
          identifierNumber: model.identifierNumber || null,
          accountName: model.gibAccountName || null,
          eInvoiceStartDate,
          eWaybillStartDate: model.eWaybillStartDate || null,
          isPassive,
          isEInvoiceTaxpayer,
          raw: model,
        },
      }
    } catch (error: any) {
      return { success: false, error: error?.message || "GİB hesap sorgulama hatası" }
    }
  }

  /**
   * Gelen e-faturanın tam modelini (kalemler dahil) Mysoft'tan çeker.
   *
   * Swagger v8: GET /api/InvoiceInbox/getInvoiceInboxModel?invoiceETTN={uuid}
   * Header listesi sadece özet bilgileri verir; kalemleri görmek için bu çağrı şart.
   * "Alış faturasına dönüştür" akışında lines (invoiceLines) buradan beslenir.
   */
  async getIncomingInvoiceModel(uuid: string): Promise<
    | {
        success: true
        data: {
          uuid: string
          invoiceNo: string | null
          date: string | null
          currency: string | null
          currencyRate: number | null
          sender: { name: string | null; taxNumber: string | null; address: string | null }
          totalAmount: number | null
          taxExclusiveAmount: number | null
          taxInclusiveAmount: number | null
          vatAmount: number | null
          lines: Array<{
            description: string | null
            productCode: string | null
            unit: string | null
            quantity: number | null
            unitPrice: number | null
            discountRate: number | null
            discountAmount: number | null
            vatRate: number | null
            vatAmount: number | null
            lineTotal: number | null
          }>
          raw: any
        }
      }
    | { success: false; error: string; rawResponse?: any }
  > {
    try {
      const token = await this.getToken()
      if (!token) return { success: false, error: "Mysoft token alınamadı." }

      const url = new URL(`${this.baseUrl}/api/InvoiceInbox/getInvoiceInboxModel`)
      url.searchParams.set("invoiceETTN", uuid)
      // Tenant'ı çöz (gerekirse JWT'den keşfet). tenantIdentifierNumber boş gidince
      // Mysoft "Kullanıcı bilgileri ile firma kullanıcı kaydı bulunamadı" döndürüyor.
      const inboxTenant = await this.resolveTenantVkn()
      if (inboxTenant) url.searchParams.set("tenantIdentifierNumber", inboxTenant)

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      })

      const result = await res.json().catch(() => null)
      if (!result || result.succeed === false) {
        return {
          success: false,
          error: result?.message || `HTTP ${res.status}`,
          rawResponse: result,
        }
      }

      const model: any = result.data || result
      const pick = (obj: any, ...keys: string[]): any => {
        for (const k of keys) {
          if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k]
        }
        return null
      }
      const num = (v: any): number | null => {
        if (v === null || v === undefined || v === "") return null
        const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v)
        return Number.isFinite(n) ? n : null
      }

      // Mysoft InvoiceForApiModel: kalemler resmî şemada "detailList" altında gelir.
      // Eski sürümler/varyantlar için "invoiceLines" / "lines" / "items" fallback'i korunur.
      const rawLines: any[] = Array.isArray(model.detailList)
        ? model.detailList
        : Array.isArray(model.invoiceLines)
          ? model.invoiceLines
          : Array.isArray(model.lines)
            ? model.lines
            : Array.isArray(model.items)
              ? model.items
              : []

      const lines = rawLines.map((ln: any) => {
        // Stok bilgisi resmî şemada "detailItem" altında nested gelir; düz (flat)
        // dönen varyantlar için ln'in kendisine fallback yapıyoruz.
        const item = ln.detailItem && typeof ln.detailItem === "object" ? ln.detailItem : ln

        // ÖNEMLİ: Ürün adı (Stok Adı / itemName) önce gelmeli. Generic "name" /
        // "description" anahtarları Mysoft'ta satır açıklamasını taşıyabildiği için
        // önce onlara bakılırsa ürün adı ile açıklama yer değiştiriyordu.
        const productName = pick(item, "itemName", "productName", "name") as string | null
        const itemDesc = pick(item, "itemDescription", "description") as string | null

        // İskonto: allowanceChargeList[].chargeIndicator === false (iskonto).
        // multiplierFactorNumeric oran olarak 0..1 gelir → %'ye çeviriyoruz.
        const allowances: any[] = Array.isArray(ln.allowanceChargeList)
          ? ln.allowanceChargeList
          : []
        const discount =
          allowances.find((a) => a?.chargeIndicator === false) || allowances[0] || null
        const discountRate =
          discount && discount.multiplierFactorNumeric != null
            ? (num(discount.multiplierFactorNumeric) ?? 0) * 100
            : num(pick(ln, "discountRate", "allowanceChargeRate"))
        const discountAmount = discount
          ? num(discount.amount)
          : num(pick(ln, "discountAmount", "allowanceChargeAmount", "allowanceTotalAmount"))

        // KDV: taxTotal.taxSubtotalList[].percent (resmî şema, object). Flat varyantlar
        // için doğrudan ln üzerindeki alanlara düşeriz.
        const taxTotalObj =
          ln.taxTotal && typeof ln.taxTotal === "object" && !Array.isArray(ln.taxTotal)
            ? ln.taxTotal
            : null
        const taxSub =
          taxTotalObj && Array.isArray(taxTotalObj.taxSubtotalList)
            ? taxTotalObj.taxSubtotalList[0]
            : null
        const vatRate = taxSub
          ? num(taxSub.percent)
          : num(pick(ln, "vatRate", "taxRate", "taxPercent"))
        const vatAmount = taxSub
          ? num(taxSub.taxAmount)
          : taxTotalObj
            ? num(taxTotalObj.taxAmount)
            : num(pick(ln, "vatAmount", "taxAmount", "taxTotalTra"))

        return {
          description: productName || itemDesc || null,
          productCode: pick(
            item,
            "sellersItemIdentificationId",
            "sellersItemIdentification",
            "productCode",
            "itemCode",
          ) as string | null,
          unit: pick(ln, "unitCode", "unit", "quantityUnitCode") as string | null,
          quantity: num(pick(ln, "invoicedQuantity", "quantity")),
          unitPrice: num(pick(ln, "unitPrice", "priceAmount", "price")),
          discountRate,
          discountAmount,
          vatRate,
          vatAmount,
          lineTotal: num(pick(ln, "lineExtensionAmount", "lineTotal", "amountTra")),
        }
      })

      return {
        success: true,
        data: {
          uuid,
          invoiceNo: pick(model, "docNo", "invoiceNo", "documentNo") as string | null,
          date: pick(model, "docDate", "invoiceDate", "issueDate") as string | null,
          currency: pick(model, "currencyCode", "currency") as string | null,
          currencyRate: num(pick(model, "currencyRate")),
          sender: {
            name: pick(model, "accountName", "senderName", "senderTitle") as string | null,
            taxNumber: pick(
              model,
              "vknTckn",
              "senderVknTckn",
              "senderVkn",
              "senderTaxNumber",
            ) as string | null,
            address: pick(model, "senderAddress", "address") as string | null,
          },
          totalAmount: num(pick(model, "payableAmount", "totalAmount", "payableAmountTra")),
          taxExclusiveAmount: num(pick(model, "taxExclusiveAmount", "amtTra", "netAmount")),
          taxInclusiveAmount: num(pick(model, "taxInclusiveAmount")),
          vatAmount: num(pick(model, "taxTotalTra", "vatAmount", "totalVatAmount")),
          lines,
          raw: model,
        },
      }
    } catch (error: any) {
      return { success: false, error: error?.message || "Bilinmeyen hata" }
    }
  }

  /**
   * Gelen e-fatura için resmî GİB PDF'i Mysoft Inbox'tan indirir.
   *
   * Swagger v8: GET /api/InvoiceInbox/getInvoiceInboxPdfAsZip?invoiceETTN={uuid}
   * Yanıt: StringResultModel { data: base64-zip } — zip içinde .pdf dosyası.
   * Outbox tarafındaki getInvoicePdf ile aynı kalıp.
   */
  async getIncomingInvoicePdf(
    uuid: string,
  ): Promise<{ success: true; pdfBuffer: Buffer } | { success: false; error: string }> {
    try {
      const token = await this.getToken()
      if (!token) return { success: false, error: "Mysoft token alınamadı." }

      const url = new URL(`${this.baseUrl}/api/InvoiceInbox/getInvoiceInboxPdfAsZip`)
      url.searchParams.set("invoiceETTN", uuid)

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      })

      const result = await res.json()
      if (!result?.succeed || !result?.data) {
        return { success: false, error: result?.message || "PDF alınamadı." }
      }

      const zipBuffer = Buffer.from(result.data, "base64")
      const JSZip = (await import("jszip")).default
      const zip = await JSZip.loadAsync(zipBuffer)
      const pdfEntry = Object.values(zip.files).find(
        (f) => !f.dir && f.name.toLowerCase().endsWith(".pdf"),
      )
      if (!pdfEntry) return { success: false, error: "Zip içinde PDF bulunamadı." }
      const pdfBuffer = await pdfEntry.async("nodebuffer")
      return { success: true, pdfBuffer }
    } catch (error: any) {
      return { success: false, error: error?.message || "PDF indirilirken hata oluştu." }
    }
  }

  async getInvoicePdf(uuid: string): Promise<{ success: true; pdfBuffer: Buffer; filename?: string } | { success: false; error: string }> {
    try {
      const token = await this.getToken();
      if (!token) return { success: false, error: "Mysoft token alınamadı." };

      // Swagger v8: GET /api/InvoiceOutbox/getInvoiceOutboxPdfAsZip → StringResultModel { data: base64-zip }
      const url = new URL(`${this.baseUrl}/api/InvoiceOutbox/getInvoiceOutboxPdfAsZip`);
      url.searchParams.set("invoiceETTN", uuid);

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      const result = await res.json();
      if (!result?.succeed || !result?.data) {
        return { success: false, error: result?.message || "PDF alınamadı." };
      }

      // base64 → zip Buffer → içindeki .pdf dosyasını çıkar
      const zipBuffer = Buffer.from(result.data, "base64");
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(zipBuffer);
      const pdfEntry = Object.values(zip.files).find((f) => !f.dir && f.name.toLowerCase().endsWith(".pdf"));
      if (!pdfEntry) return { success: false, error: "Zip içinde PDF bulunamadı." };
      const pdfBuffer = await pdfEntry.async("nodebuffer");
      // GİB zip'i içindeki PDF, resmî belge adıyla gelir (klasör yolu olmadan al).
      const filename = pdfEntry.name.split("/").pop() || pdfEntry.name;
      return { success: true, pdfBuffer, filename };
    } catch (error: any) {
      return { success: false, error: error?.message || "PDF indirilirken hata oluştu." };
    }
  }

  /**
   * Mysoft tarafında tanımlı numaratör (prefix) listesini getirir.
   * Swagger v8: GET /api/Tenant/getDocumentNumberList?vknTckn={optional}
   */
  async listNumerators(vknTckn?: string): Promise<{
    success: boolean
    data?: Array<{
      prefix: string
      edocumentType: string
      edocumentTypeDescription: string
      isDefault: boolean
      isInternetSales: boolean
      isPassive: boolean
    }>
    error?: string
  }> {
    try {
      const token = await this.getToken()
      if (!token) return { success: false, error: "Mysoft token alınamadı." }

      const url = new URL(`${this.baseUrl}/api/Tenant/getDocumentNumberList`)
      // Swagger v8: vknTckn OPSİYONEL — verilmezse login kullanıcısının "varsayılan
      // hesabı" (Mysoft müşteri API'sinde her zaman vardır) kullanılır. Bu yüzden:
      //  1) Açıkça verilen vknTckn'yi tercih et.
      //  2) Yoksa cache'lenmiş veya constructor'da geçilen VKN'yi kullan.
      //  3) O da yoksa çağrıyı vknTckn olmadan yap (default tenant). Eski kod burada
      //     `resolveTenantVkn` çağırıyordu ve resolver hata verirse listele hiç denenmiyordu.
      const effectiveVkn = (vknTckn || this.vknTckn || this.resolvedTenantVkn || "").trim() || null
      if (effectiveVkn) url.searchParams.set("vknTckn", effectiveVkn)

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      })

      const result = await res.json()
      if (!result?.succeed) {
        console.error(
          "[Mysoft] listNumerators failed. effectiveVkn=",
          effectiveVkn || "(none)",
          "raw response:",
          JSON.stringify(result),
        )
        const msg: string = result?.message || ""
        return { success: false, error: msg || "Numaratör listesi alınamadı." }
      }
      return { success: true, data: Array.isArray(result.data) ? result.data : [] }
    } catch (error: any) {
      return { success: false, error: error?.message || "Bilinmeyen bir hata oluştu." }
    }
  }

  /**
   * Yeni numaratör tanımlar.
   * Swagger v8: POST /api/Tenant/addDocumentNumber
   *
   * eDocumentType: 1=E-Fatura, 2=E-Arşiv, 3=E-İrsaliye, 4=E-İrsaliye Yanıtı,
   * 5=E-SMM, 6=E-MM, 7=E-Döviz Satım, 8=E-Döviz Alım, 9=E-Adisyon,
   * 10=GİB E-Arşiv, 11=E-Dekont
   */
  async addNumerator(params: {
    prefix: string
    eDocumentType: number
    isDefault?: boolean
    isInternetSales?: boolean
    isPassive?: boolean
    lastNumber?: number
    identifierNumber?: string
  }): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const token = await this.getToken()
      if (!token) return { success: false, error: "Mysoft token alınamadı." }

      // addDocumentNumber için identifierNumber OPSİYONEL (Swagger v8). Verilmezse
      // login kullanıcısının varsayılan tenant'ı kullanılır. Üç adımda çöz:
      //  1) Explicit param
      //  2) Constructor'da geçilen / önceden keşfedilmiş VKN
      //  3) Boş (Mysoft default tenant'ı kullanır)
      const identifierNumber =
        (params.identifierNumber || this.vknTckn || this.resolvedTenantVkn || "").trim() || undefined

      const res = await fetch(`${this.baseUrl}/api/Tenant/addDocumentNumber`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prefix: params.prefix,
          eDocumentType: params.eDocumentType,
          isDefault: params.isDefault ?? false,
          isInternetSales: params.isInternetSales ?? false,
          isPassive: params.isPassive ?? false,
          lastNumber: params.lastNumber ?? 0,
          identifierNumber,
        }),
      })

      const result = await res.json()
      if (!result?.succeed) {
        console.error(
          "[Mysoft] addNumerator failed. identifierNumber=",
          identifierNumber || "(none)",
          "params=",
          JSON.stringify({ prefix: params.prefix, eDocumentType: params.eDocumentType }),
          "raw response:",
          JSON.stringify(result),
        )
        return { success: false, error: result?.message || "Numaratör eklenemedi." }
      }
      return { success: true, message: result?.message || "Numaratör eklendi." }
    } catch (error: any) {
      return { success: false, error: error?.message || "Bilinmeyen bir hata oluştu." }
    }
  }

  /**
   * Tek bir dosyayı (XSLT) zip'leyip base64 string'e çevirir.
   * Mysoft'un addTenantXslt / getXsltPreview* endpoint'leri xsltFile alanını
   * "ziplendikten sonra base64'e çevrilmiş" formatta ister.
   */
  private async zipFileToBase64(fileName: string, content: string): Promise<string> {
    const JSZip = (await import("jszip")).default
    const zip = new JSZip()
    zip.file(fileName, content)
    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
    return buf.toString("base64")
  }

  /**
   * Firmaya tanımlı belge dizaynlarını (XSLT) listeler.
   * Swagger v8: POST /api/Tenant/getTenantXslt
   */
  async listTenantXslt(
    vknTckn?: string,
    eDocumentType?: number,
  ): Promise<{
    success: boolean
    data?: Array<{
      id: number
      eDocumentTypeEnumText: string | null
      xsltName: string | null
      isDefault: boolean
      isInternetSales: boolean
      isApproved: boolean | null
      approvedDate: string | null
    }>
    error?: string
  }> {
    try {
      const token = await this.getToken()
      if (!token) return { success: false, error: "Mysoft token alınamadı." }

      const effectiveVkn = (vknTckn || this.vknTckn || this.resolvedTenantVkn || "").trim()
      if (!effectiveVkn) return { success: false, error: "Mükellef VKN bulunamadı." }

      const body: any = { vknTckn: effectiveVkn }
      if (typeof eDocumentType === "number") body.edocumentType = eDocumentType

      const res = await fetch(`${this.baseUrl}/api/Tenant/getTenantXslt`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const result = await res.json()
      if (!result?.succeed) {
        return { success: false, error: result?.message || "Şablon listesi alınamadı." }
      }
      return { success: true, data: Array.isArray(result.data) ? result.data : [] }
    } catch (error: any) {
      return { success: false, error: error?.message || "Bilinmeyen bir hata oluştu." }
    }
  }

  /**
   * Firmaya yeni belge dizaynı (XSLT) ekler.
   * Swagger v8: POST /api/Tenant/addTenantXslt
   * @param content Ham XSLT içeriği (zip'leme/base64 burada yapılır).
   */
  async addTenantXslt(params: {
    xsltName: string
    eDocumentType: number
    content: string
    fileName?: string
    isHasLogo?: boolean
    isHasStamp?: boolean
    vknTckn?: string
  }): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const token = await this.getToken()
      if (!token) return { success: false, error: "Mysoft token alınamadı." }

      const effectiveVkn = (params.vknTckn || this.vknTckn || this.resolvedTenantVkn || "").trim()
      if (!effectiveVkn) return { success: false, error: "Mükellef VKN bulunamadı." }

      const xsltFile = await this.zipFileToBase64(params.fileName || "design.xslt", params.content)

      const res = await fetch(`${this.baseUrl}/api/Tenant/addTenantXslt`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          vknTckn: effectiveVkn,
          xsltName: params.xsltName,
          edocumentType: params.eDocumentType,
          xsltFile,
          isHasLogo: params.isHasLogo ?? false,
          isHasStamp: params.isHasStamp ?? false,
        }),
      })
      const result = await res.json()
      if (!result?.succeed) {
        return { success: false, error: result?.message || "Şablon eklenemedi." }
      }
      return { success: true, message: result?.message || "Şablon eklendi." }
    } catch (error: any) {
      return { success: false, error: error?.message || "Bilinmeyen bir hata oluştu." }
    }
  }

  /**
   * Bir XSLT'nin PDF önizlemesini döndürür (henüz kaydetmeden test etmek için).
   * Swagger v8: POST /api/Tenant/getXsltPreviewPdf → StringResultModel { data: base64 }
   */
  async getXsltPreviewPdf(params: {
    eDocumentType: number
    content: string
    fileName?: string
    isInternetSales?: boolean
  }): Promise<{ success: true; pdfBuffer: Buffer } | { success: false; error: string }> {
    try {
      const token = await this.getToken()
      if (!token) return { success: false, error: "Mysoft token alınamadı." }

      const xsltFile = await this.zipFileToBase64(params.fileName || "design.xslt", params.content)

      const res = await fetch(`${this.baseUrl}/api/Tenant/getXsltPreviewPdf`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          edocumentType: params.eDocumentType,
          xsltFile,
          ...(typeof params.isInternetSales === "boolean"
            ? { isInternetSales: params.isInternetSales }
            : {}),
        }),
      })
      const result = await res.json()
      if (!result?.succeed || !result?.data) {
        return { success: false, error: result?.message || "Önizleme alınamadı." }
      }

      // data base64 → zip içinde PDF olabilir ya da doğrudan PDF base64'ü olabilir.
      const raw = Buffer.from(result.data, "base64")
      // %PDF imzası varsa doğrudan PDF'tir.
      if (raw.slice(0, 4).toString("latin1") === "%PDF") {
        return { success: true, pdfBuffer: raw }
      }
      try {
        const JSZip = (await import("jszip")).default
        const zip = await JSZip.loadAsync(raw)
        const pdfEntry = Object.values(zip.files).find(
          (f) => !f.dir && f.name.toLowerCase().endsWith(".pdf"),
        )
        if (pdfEntry) {
          const pdfBuffer = await pdfEntry.async("nodebuffer")
          return { success: true, pdfBuffer }
        }
      } catch {
        // zip değilse aşağıda ham buffer'ı PDF kabul et
      }
      return { success: true, pdfBuffer: raw }
    } catch (error: any) {
      return { success: false, error: error?.message || "Önizleme alınırken hata oluştu." }
    }
  }
}