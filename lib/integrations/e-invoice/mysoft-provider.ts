import { EInvoiceProvider } from "./types"
import { resolveMysoftBaseUrl } from "./constants"
import { normalizeUnitCode } from "@/lib/data/units"

// GİB "Diğer Vergiler" (KDV/ÖTV dışı) vergi türü kodları → okunur ad. Gelen faturada
// alt-toplamın taxName'i boş gelirse bu tablodan ada çevrilir; kod da tanınmıyorsa
// "Diğer Vergi (kod)" olarak gösterilir. Böylece hangi vergi kalemi olduğu hep bellidir.
const GIB_OTHER_TAX_NAMES: Record<string, string> = {
  "0059": "Konaklama Vergisi",
  "4071": "Elektrik Tüketim Vergisi",
  "4080": "Özel İletişim Vergisi",
}
function resolveOtherTaxName(code: string | null | undefined): string | null {
  const c = (code ?? "").trim()
  if (!c) return null
  return GIB_OTHER_TAX_NAMES[c] || `Diğer Vergi (${c})`
}

// GİDEN fatura: "Diğer Vergi" ADINDAN GİB vergi türü kodunu türetir (tax[].taxCode).
// GIB_OTHER_TAX_NAMES'in ters yönü + yaygın eşanlamlılar. Bulunamazsa null döner →
// o zaman kod göndermeden yalnız taxName ile "diğer vergi" olarak iletilir.
function resolveOtherTaxCode(name: string | null | undefined): string | null {
  const n = (name ?? "").trim().toLocaleLowerCase("tr")
  if (!n) return null
  if (n.includes("konaklama")) return "0059"
  if (n.includes("elektrik") || n.includes("havagaz") || n.includes("btv")) return "4071"
  if (n.includes("özel iletişim") || n.includes("ozel iletisim") || n === "öiv" || n === "oiv")
    return "4080"
  return null
}

// ÖTV vergi türü kodu belirsizse (kullanıcı liste seçmediyse / eski kayıt) son çare.
// 0074 = IV sayılı liste (dayanıklı tüketim ve diğer mallar) — en yaygın genel kategori.
const DEFAULT_EXCISE_CODE = "0074"

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
  // OAuth token cache — aynı provider örneği içinde yalnızca BİR kez giriş yap,
  // token süresi dolana kadar tekrar kullan. Tek bir istekte (tenant keşfi +
  // model çekme gibi) Mysoft'a defalarca oauth/token çağrısı yapmayı önler.
  private cachedToken?: string;
  private tokenExpiresAt = 0;

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

  // ===========================================================================
  // İŞ ORTAĞI (BAYİ) ONBOARDING — firma açma + ürün aktivasyonu
  //
  // Bu üç metod da BAYİ (İş Ortağı) kimliğiyle çağrılmalıdır (createPartnerProvider).
  // Amaç: müşterinin Mysoft ile hiç muhatap olmadan, Kobipo üzerinden e-Dönüşüm
  // hesabını açması. Belge gönderimi sonradan bayi kimliği + tenantIdentifierNumber
  // ile yapılır. Detaylı plan: docs/e-donusum-onboarding/PLAN.md
  // ===========================================================================

  /**
   * Bayi altında yeni bir mükellef (firma/tenant) açar.
   * Swagger v8: POST /api/Tenant/addTenant (ApiTenantModel → Int32ResultModel).
   * addTariffToTenant:true → bayiye tanımlı tarifeler firmaya devreder; böylece
   * firma daha sonra kontör alıp fatura kesebilir. Adres opsiyonel (required değil).
   * Başarılıysa Mysoft'un atadığı yeni tenant id'sini döndürür.
   */
  async createTenant(params: {
    tenantName: string
    shortName: string
    vknTckn: string
    email: string
    registerNo: string
    taxOfficeCode?: string
    taxOfficeName?: string
    telephone?: string
    address?: {
      countryCode?: string
      countryName?: string
      cityCode?: string
      cityName?: string
      citySubdivision?: string // ilçe — TenantAdressModel'de zorunlu
      district?: string
      streetName?: string
      buildingName?: string
      buildingNumber?: string
      postalCode?: string
    }
    addTariffToTenant?: boolean
  }): Promise<{ success: boolean; tenantId?: number; error?: string; raw?: any }> {
    try {
      const token = await this.getToken()
      if (!token) return { success: false, error: "Mysoft token alınamadı." }

      const body: Record<string, unknown> = {
        tenantName: params.tenantName,
        shortName: params.shortName,
        vknTckn: params.vknTckn,
        email: params.email,
        registerNo: params.registerNo,
        addTariffToTenant: params.addTariffToTenant ?? true,
      }
      if (params.telephone) body.telephone = params.telephone
      if (params.taxOfficeCode || params.taxOfficeName) {
        body.taxOffice = {
          taxOfficeCode: params.taxOfficeCode || null,
          taxOfficeName: params.taxOfficeName || null,
        }
      }
      // TenantAdressModel: country/city = GeneralLookupModel {code,name}; citySubdivision
      // (ilçe) zorunlu. Adres required listesinde olmadığı için yalnızca verilirse gönderilir.
      if (params.address) {
        const a = params.address
        body.tenantAdress = {
          country: { code: a.countryCode || "TR", name: a.countryName || "TÜRKİYE" },
          city: { code: a.cityCode || null, name: a.cityName || null },
          citySubdivision: a.citySubdivision || null,
          district: a.district || null,
          streetName: a.streetName || null,
          buildingName: a.buildingName || null,
          buildingNumber: a.buildingNumber || null,
          postalCode: a.postalCode || null,
        }
      }

      const res = await fetch(`${this.baseUrl}/api/Tenant/addTenant`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      console.log("[Mysoft] addTenant raw:", res.status, JSON.stringify(data))
      if (!data?.succeed) {
        return {
          success: false,
          error: data?.message || `Firma açılamadı (HTTP ${res.status})`,
          raw: data,
        }
      }
      const tenantId =
        typeof data?.data === "number" ? data.data : Number(data?.data) || undefined
      return { success: true, tenantId, raw: data }
    } catch (error: any) {
      return { success: false, error: error?.message || "Bilinmeyen hata" }
    }
  }

  /**
   * Firmaya bir e-Dönüşüm ürünü aktive eder (GİB başvurusu oluşturur).
   * Swagger v8: POST /api/Tenant/addTenantActivation (ApiTenantActivationModel).
   * activationProductType: "EInvoice" | "EArchive" | "EDespatch" | ... (bkz. PLAN.md).
   * E-Fatura/E-Arşiv/E-İrsaliye'de serialNumberPrefix; E-Fatura/E-İrsaliye'de
   * activationAlias (posta kutusu) zorunludur. Başvuru GİB'e iletilir; durumu
   * getTenantActivationStatus ile takip edilir. Dönüş: Mysoft aktivasyon kayıt id'si.
   */
  async activateProduct(params: {
    vknTckn: string
    activationProductType: string
    serialNumberPrefix?: string
    internetSerialNumberPrefix?: string
    aliasPrefix?: string
    aliasDomain?: string
    activationDemandDate?: string // ISO; boşsa şimdi
  }): Promise<{ success: boolean; activationId?: number; error?: string; raw?: any }> {
    try {
      const token = await this.getToken()
      if (!token) return { success: false, error: "Mysoft token alınamadı." }

      const body: Record<string, unknown> = {
        id: 0,
        vknTckn: params.vknTckn,
        activationDemandDate: params.activationDemandDate || new Date().toISOString(),
        activationProductType: params.activationProductType,
      }
      if (params.serialNumberPrefix) body.serialNumberPrefix = params.serialNumberPrefix
      if (params.internetSerialNumberPrefix)
        body.internetSerialNumberPrefix = params.internetSerialNumberPrefix
      if (params.aliasPrefix || params.aliasDomain) {
        body.activationAlias = {
          aliasPrefix: params.aliasPrefix || null,
          domainName: params.aliasDomain || null,
        }
      }

      const res = await fetch(`${this.baseUrl}/api/Tenant/addTenantActivation`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      console.log("[Mysoft] addTenantActivation raw:", res.status, JSON.stringify(data))
      if (!data?.succeed) {
        return {
          success: false,
          error: data?.message || `Aktivasyon başvurusu başarısız (HTTP ${res.status})`,
          raw: data,
        }
      }
      const activationId =
        typeof data?.data === "number" ? data.data : Number(data?.data) || undefined
      return { success: true, activationId, raw: data }
    } catch (error: any) {
      return { success: false, error: error?.message || "Bilinmeyen hata" }
    }
  }

  /**
   * Firmanın aktivasyon (GİB başvuru) durumlarını döndürür.
   * Swagger v8: GET /api/Tenant/getTenantActivation?vknTckn=...
   * activationDemandStatus: WillBeSendToGib → SentToGib → Approved / Canceled /
   * Error / Wait / Close. gibServiceStatus/Message = GİB başvuru durum kodu/açıklaması.
   */
  async getTenantActivationStatus(vknTckn: string): Promise<{
    success: boolean
    data?: Array<{
      productType: string | null
      demandType: string | null
      demandStatus: string | null
      gibServiceStatus: string | null
      gibServiceMessage: string | null
      serialNumberPrefix: string | null
    }>
    error?: string
    raw?: any
  }> {
    try {
      const token = await this.getToken()
      if (!token) return { success: false, error: "Mysoft token alınamadı." }

      const res = await fetch(
        `${this.baseUrl}/api/Tenant/getTenantActivation?vknTckn=${encodeURIComponent(
          vknTckn,
        )}&limit=50`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        },
      )
      const data = await res.json().catch(() => null)
      if (!data?.succeed) {
        return {
          success: false,
          error: data?.message || `Aktivasyon durumu alınamadı (HTTP ${res.status})`,
          raw: data,
        }
      }
      const rows: any[] = Array.isArray(data?.data) ? data.data : []
      return {
        success: true,
        data: rows.map((r) => ({
          productType: r?.activationProductType ?? null,
          demandType: r?.activationDemandType ?? null,
          demandStatus: r?.activationDemandStatus ?? null,
          gibServiceStatus: r?.gibServiceStatus ?? null,
          gibServiceMessage: r?.gibServiceMessage ?? null,
          serialNumberPrefix: r?.serialNumberPrefix ?? null,
        })),
        raw: data,
      }
    } catch (error: any) {
      return { success: false, error: error?.message || "Bilinmeyen hata" }
    }
  }

  /**
   * Mysoft'ta tanımlı vergi dairelerini (kod + ad) döndürür.
   * Swagger v8: GET /api/GeneralCard/taxOffice (TaxOfficeModelListResultModel).
   * addTenant için taxOffice serbest metinle DEĞİL, bu listedeki kod+ad ile gönderilmeli
   * (aksi halde errorCode 00081 "Vergi dairesi tanımı bulunamadı").
   */
  async listTaxOffices(): Promise<{
    success: boolean
    data: Array<{ code: string; name: string }>
    error?: string
  }> {
    try {
      const token = await this.getToken()
      if (!token) return { success: false, data: [], error: "Mysoft token alınamadı." }
      const res = await fetch(`${this.baseUrl}/api/GeneralCard/taxOffice`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      })
      const data = await res.json().catch(() => null)
      if (!data?.succeed) {
        return { success: false, data: [], error: data?.message || `HTTP ${res.status}` }
      }
      const rows: any[] = Array.isArray(data?.data) ? data.data : []
      return {
        success: true,
        data: rows
          .map((r) => ({
            code: String(r?.taxOfficeCode ?? "").trim(),
            name: String(r?.taxOfficeName ?? "").trim(),
          }))
          .filter((r) => r.code && r.name),
      }
    } catch (error: any) {
      return { success: false, data: [], error: error?.message || "Bilinmeyen hata" }
    }
  }

  /**
   * Mysoft'ta tanımlı şehirleri (kod + ad) döndürür.
   * Swagger v8: GET /api/GeneralCard/city (CityModelListResultModel).
   * addTenant adresinde şehir GeneralLookupModel {code,name} bekler; kod bu listeden gelir.
   */
  async listCities(): Promise<{
    success: boolean
    data: Array<{ code: string; name: string; countryCode: string }>
    error?: string
  }> {
    try {
      const token = await this.getToken()
      if (!token) return { success: false, data: [], error: "Mysoft token alınamadı." }
      const res = await fetch(`${this.baseUrl}/api/GeneralCard/city`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      })
      const data = await res.json().catch(() => null)
      if (!data?.succeed) {
        return { success: false, data: [], error: data?.message || `HTTP ${res.status}` }
      }
      const rows: any[] = Array.isArray(data?.data) ? data.data : []
      return {
        success: true,
        data: rows
          .map((r) => ({
            code: String(r?.cityCode ?? "").trim(),
            name: String(r?.cityName ?? "").trim(),
            countryCode: String(r?.countryCode ?? "").trim(),
          }))
          .filter((r) => r.code && r.name),
      }
    } catch (error: any) {
      return { success: false, data: [], error: error?.message || "Bilinmeyen hata" }
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
      // unitPriceTra için UBL standardı 6 ondalığa kadar izin verir (Türk e-Fatura
      // pratiği); 26 × 15384,615385 = 400.000 gibi tam toplama ulaşabilmek için.
      const round6 = (n: number) => Math.round(n * 1000000) / 1000000;

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
          // KDV tevkifatı: kod + tevkif edilen KDV yüzdesi (matrah/tutar rowVat'tan hesaplanır).
          const withholdingCode = typeof item.withholdingCode === "string" && item.withholdingCode.trim()
            ? item.withholdingCode.trim()
            : null;
          const withholdingName = typeof item.withholdingName === "string" && item.withholdingName.trim()
            ? item.withholdingName.trim()
            : null;
          const withholdingRate = Number(item.withholdingRate) || 0;
          // ÖTV: oran + GİB liste kodu (0071/0073/0074...). Tutar iskonto sonrası
          // matrah (l.taxable) üzerinden hesaplanır — KDV ile aynı taban.
          const exciseRate = Number(item.exciseRate) || 0;
          const exciseCode = typeof item.exciseCode === "string" && item.exciseCode.trim()
            ? item.exciseCode.trim()
            : null;
          // Diğer Vergi (KDV/ÖTV dışı ek vergi): oran + serbest ad. Ad → GİB kodu
          // resolveOtherTaxCode ile türetilir.
          const otherTaxRate = Number(item.otherTaxRate) || 0;
          const otherTaxName = typeof item.otherTaxName === "string" && item.otherTaxName.trim()
            ? item.otherTaxName.trim()
            : null;
          const otherTaxCode = typeof item.otherTaxCode === "string" && item.otherTaxCode.trim()
            ? item.otherTaxCode.trim()
            : null;
          // Pro-rata global discount payı sonradan eklenecek.
          return { item, qty, unitPrice, vatRate, rowTotal, lineDiscount, discountRate, exemptionCode, exemptionReason, withholdingCode, withholdingName, withholdingRate, exciseRate, exciseCode, otherTaxRate, otherTaxName, otherTaxCode, globalShare: 0, taxable: rowTotal - lineDiscount, rowVat: 0, excise: 0, otherTax: 0 };
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

      // Fatura altı İLAVE (masraf): iskontonun tersi, matrahı ARTIRIR. İskontoyla
      // AYNI gerekçeyle satırlara pro-rata yayılır — header-level allowanceCharge
      // bazı XSLT'lerde görünmediği için satıra yayılmış değer her şablonda doğru
      // render edilir ve KDV doğru hesaplanır. globalShare NEGATİF pay olarak
      // eklenir; aşağıdaki matrah hesabı (rowTotal - lineDiscount - globalShare)
      // böylece ilaveyi kendiliğinden ekler.
      const rawGlobalCharge = Math.max(0, Number(invoiceData.globalChargeAmount) || 0);
      // Dip toplamlarda ayrıca raporlanacak (chargeTotalAmount / allowanceTotalAmount).
      const appliedGlobalChargeTotal =
        rawGlobalCharge > 0 && subtotalNetForGlobal > 0 ? round2(rawGlobalCharge) : 0;
      const appliedRoundingAmount = round2(Number(invoiceData.payableRoundingAmount) || 0);
      if (rawGlobalCharge > 0 && subtotalNetForGlobal > 0) {
        let distributedCharge = 0;
        lineData.forEach((l: any, idx: number) => {
          const lineNet = l.rowTotal - l.lineDiscount;
          const isLast = idx === lineData.length - 1;
          const share = isLast
            ? round2(Math.max(0, rawGlobalCharge - distributedCharge))
            : round2((lineNet / subtotalNetForGlobal) * rawGlobalCharge);
          l.globalShare = round2(l.globalShare - share);
          distributedCharge += share;
        });
      }

      // Yeni matrah ve KDV: lineDiscount + globalShare düşülmüş tutar üzerinden.
      // GİB şematron 2-ondalık kuralı: TUTAR alanları (amtTra/taxableAmtTra/
      // amtVatTra) 2 ondalığa yuvarlanır. unitPriceTra UBL standardında 6+
      // ondalığa kadar geçerlidir — kullanıcı girdiği hassasiyeti koruyoruz
      // (ör. 26 × 15384,615385 = 400.000,00 tam tutar elde etmek için gerekli).
      lineData.forEach((l: any) => {
        l.taxable = round2(l.rowTotal - l.lineDiscount - l.globalShare);
        l.rowVat = round2((l.taxable * l.vatRate) / 100);
        // ÖTV ve Diğer Vergi de iskonto sonrası matrah (l.taxable) üzerinden — KDV ile
        // aynı taban. Böylece GİB'e giden ek vergiler editör/önizleme özetiyle tutar.
        l.excise = l.exciseRate > 0 ? round2((l.taxable * l.exciseRate) / 100) : 0;
        l.otherTax = l.otherTaxRate > 0 ? round2((l.taxable * l.otherTaxRate) / 100) : 0;
        l.lineDiscount = round2(l.lineDiscount);
        l.rowTotal = round2(l.rowTotal);
        // l.unitPrice: round'lamadan orijinal hassasiyetle gönderilir.
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

      // --- BAŞLIK (LegalMonetaryTotal / "dip toplamlar") ---
      // isManuelCalculation:false iken Mysoft başlığı Σ(miktar × birim fiyat)'tan
      // kurar ve İSKONTOLARI HİÇ DÜŞMEZ → resmî GİB görselinde "Vergiler Dahil
      // Toplam Tutar" ve "Ödenecek Tutar" toplam iskonto kadar şişkin çıkar.
      // (Satır amtTra'sını net göndermek veya isSubtractDiscountFromAmtTra bayrağı
      // başlığı DEĞİŞTİRMİYOR — draft UBL/şematron uçlarıyla doğrulandı.)
      // Çözüm: dip toplamları invoiceCalculation ile kendimiz göndeririz
      // (Swagger: "isManuelCalculation = true gönderilirse buradaki rakamlar
      // kullanılır"). Eşitlikler kurgu gereği tutarlı: allowanceTotal brüt−matrah
      // olarak TÜRETİLİR ki kuruş yuvarlama kaymasında bile denklem bozulmasın.
      const totalGross = round2(lineData.reduce((s: number, l: any) => s + l.rowTotal, 0))
      const totalTaxable = round2(lineData.reduce((s: number, l: any) => s + l.taxable, 0))
      const totalVat = round2(lineData.reduce((s: number, l: any) => s + l.rowVat, 0))
      const totalExtraTax = round2(lineData.reduce((s: number, l: any) => s + l.excise + l.otherTax, 0))
      // Satırlara yazılan tevkifat tutarlarının birebir toplamı (aynı koşul + aynı
      // yuvarlama — detail.withholdingTaxAmount ile kuruşu kuruşuna aynı olmalı).
      const totalWithholding = round2(
        lineData.reduce(
          (s: number, l: any) =>
            s +
            (l.withholdingCode && l.withholdingRate > 0 && l.rowVat > 0
              ? round2((l.rowVat * l.withholdingRate) / 100)
              : 0),
          0,
        ),
      )
      const taxInclusiveTotal = round2(totalTaxable + totalVat + totalExtraTax)
      const invoiceCalculation = {
        lineExtensionAmount: totalGross,          // Σ miktar × birim fiyat (brüt)
        taxExclusiveAmount: totalTaxable,         // iskontolar düşülmüş net matrah
        taxInclusiveAmount: taxInclusiveTotal,    // matrah + KDV + ek vergiler (ÖTV/ÖİV/diğer)
        // İskonto ve İLAVE ayrı raporlanır. İlave satırlara pro-rata yayıldığı için
        // totalTaxable'ın İÇİNDE; allowanceTotal'ı brüt farkından türetirken ilaveyi
        // geri eklemezsek iskonto olduğundan AZ görünür (ör. ilave 21,31 varken
        // allowance 21,31 eksik çıkar) ve GİB dip toplam kontrolü tutmaz.
        allowanceTotalAmount: round2(totalGross - totalTaxable + appliedGlobalChargeTotal),
        chargeTotalAmount: appliedGlobalChargeTotal,
        // Dip toplam yuvarlaması: KDV'ye girmez, yalnız ödenecek tutara eklenir.
        // Önceden sabit 0 gönderiliyordu; yuvarlamalı fatura kesilirse GİB'e giden
        // belge, uygulamada gördüğümüz tutardan farklı oluyordu.
        payableRoundingAmount: appliedRoundingAmount,
        payableAmount: round2(taxInclusiveTotal - totalWithholding + appliedRoundingAmount),
      }

      const isoDate = invoiceData.date instanceof Date ? invoiceData.date.toISOString() : new Date(invoiceData.date).toISOString();

      // Vade tarihi (opsiyonel). Fatura tarihi gibi tarih-only saklandığı için Z ekli
      // ISO olarak gider; Mysoft tarih kısmını okur.
      const dueRaw = invoiceData.dueDate
        ? (invoiceData.dueDate instanceof Date ? invoiceData.dueDate : new Date(invoiceData.dueDate))
        : null;
      const isoDueDate = dueRaw && Number.isFinite(dueRaw.getTime()) ? dueRaw.toISOString() : null;

      // docTime: e-Arşiv'de saat bilgisi ZORUNLU (swagger: "e-Arşiv Faturalarda saat
      // bilgisi koyma zorunluluğunuz bulunuyor"). Fatura tarihi saatsiz seçildiği için
      // buraya docDate verilirse belge hep 00:00 düzenlenmiş görünüyordu. Belgenin
      // OLUŞTURULDUĞU andaki Türkiye saatini faturanın kendi gününe yazıyoruz: bugünkü
      // faturalarda gerçek saat, geçmiş tarihlilerde o güne düşen makul bir saat olur.
      const trClock = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Istanbul",
        hourCycle: "h23",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date());
      const isoDocTime = `${isoDate.slice(0, 10)}T${trClock}.000Z`;

      // İstisnalı (vatRate=0 + exemption kodu olan) en az bir kalem varsa Mysoft'un
      // şematron kuralı gereği invoiceType=ISTISNA olmalı (SATIS reddedilir).
      const hasExemption = lineData.some((l: any) => l.vatRate === 0 && l.exemptionCode);
      // KDV tevkifatı içeren faturada GİB şematronu invoiceType=TEVKIFAT bekler;
      // SATIS/ISTISNA reddedilir ("cac:WithholdingTaxTotal varken tip TEVKIFAT olabilir").
      const hasWithholding = lineData.some(
        (l: any) => l.withholdingCode && l.withholdingRate > 0 && l.rowVat > 0,
      );
      const resolvedInvoiceType = hasWithholding ? "TEVKIFAT" : hasExemption ? "ISTISNA" : "SATIS";

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
      // Taslak PDF/kesinleştirme akışında ETTN dışarıdan (mevcut taslağın uuid'si)
      // verilebilir; verilmezse yeni üret. Böylece taslak ve önizleme aynı ETTN'i taşır.
      const generatedEttn =
        typeof invoiceData.ettn === "string" && invoiceData.ettn.trim()
          ? invoiceData.ettn.trim()
          : typeof (globalThis as any).crypto?.randomUUID === "function"
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
        // Boş = numarayı Mysoft numaratörden atasın (gerçek gönderim böyle çalışır).
        // Yalnız TASLAK PDF önizlemesinde, taslakta atanmış numarayı geri veriyoruz;
        // aksi halde şablondaki "Fatura No" alanı boş basılıyor.
        "docNo": typeof invoiceData.docNo === "string" ? invoiceData.docNo.trim() : "",
        "docDate": isoDate,
        "docTime": isoDocTime,
        ...(isoDueDate ? { dueDate: isoDueDate } : {}),
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
        // Dip toplamlar bizden (yukarıdaki invoiceCalculation). false bırakılırsa
        // Mysoft brütten kurup iskontoyu düşmüyor → Ödenecek Tutar yanlış çıkıyordu.
        "isManuelCalculation": true,
        "invoiceCalculation": invoiceCalculation,
        // Taslak modu: isSaveAsDraft=true ise Mysoft faturayı GİB'e GÖNDERMEZ,
        // taslak olarak saklar; isGenerateDocNoForDraft ile belge/sıra no da üretir.
        // Aynı ettn (payload.ettn) hem taslakta hem kesinleştirmede kullanılır.
        ...(invoiceData.isSaveAsDraft
          ? { isSaveAsDraft: true, isGenerateDocNoForDraft: true }
          : {}),
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
            // Kobipo'da cari adresi tek serbest metin (kapı/bina no dahil) → tümü
            // streetName'e. buildingNumber (Bina No) AccountModel'de opsiyonel/nullable;
            // sabit "1" gönderilince tüm faturalarda adreste "No:1" çıkıyordu → boş bırak.
            "streetName": invoiceData.customer?.address || "-"
        },

        "invoiceDetail": lineData.map((l: any) => {
            const detail: any = {
                productCode: l.item.productId || "URUN",
                productName: l.item.description || "Muhtelif Ürün/Hizmet",
                unitCode: "C62",
                qty: l.qty,
                unitPriceTra: round6(l.unitPrice), // 6 ondalık (UBL standardı)
                amtTra: l.rowTotal,        // brüt (qty * unitPrice), 2 ondalık
                taxableAmtTra: l.taxable,  // matrah (brüt - satır iskonto - global pay), 2 ondalık
                vatRate: l.vatRate,
                amtVatTra: l.rowVat,       // matrah * vatRate / 100, 2 ondalık
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
            // KDV tevkifatı (Swagger v8 satır alanları). Tevkifat matrahı = hesaplanan
            // KDV (rowVat); tevkif edilen tutar = matrah × oran/100. Oran yalnız kod
            // 650'de manuel gönderilir; diğer kodlarda Mysoft oranı koddan bilir.
            if (l.withholdingCode && l.withholdingRate > 0 && l.rowVat > 0) {
                detail.withholdingTaxTypeCode = l.withholdingCode;
                detail.withholdingTaxTypeName = l.withholdingName || l.withholdingCode;
                detail.withholdingTaxableAmount = l.rowVat;
                detail.withholdingTaxAmount = round2((l.rowVat * l.withholdingRate) / 100);
                // Yüzdeyi her kodda gönder: GİB şematronu UBL'de Percent alanının
                // 0/boş olmasını reddediyor ("601 vergi tipinin yüzdesi 0 olamaz").
                detail.withholdingTaxPercentage = l.withholdingRate;
            }
            // EK VERGİLER (ÖTV + Diğer Vergi) → InvoiceOutboxDetailTaxModel dizisi.
            // KDV satırın kendi alanlarına yazılır (yukarıda); tax[] YALNIZ ÖİV/ÖTV/diğer
            // ek vergiler içindir (Swagger v8). Taban her zaman iskonto sonrası matrah
            // (l.taxable) — KDV ile aynı — böylece GİB toplamı editör/önizleme ile tutar.
            const extraTaxes: any[] = [];
            if (l.exciseRate > 0 && l.excise > 0) {
                // ÖTV: GİB liste koduyla tanınır (0071/0073/0074...). Swagger notu gereği
                // ÖTV/ÖİV için taxName ayrıca gönderilmez; kod belirsizse son çare 0074.
                extraTaxes.push({
                    taxCode: l.exciseCode || DEFAULT_EXCISE_CODE,
                    taxRate: l.exciseRate,
                    taxAmount: l.excise,
                    taxableAmount: l.taxable,
                });
            }
            if (l.otherTaxRate > 0 && l.otherTax > 0) {
                // Diğer Vergi: önce kullanıcının seçtiği GİB kodu (otherTaxCode), yoksa
                // addan türet (Konaklama 0059 / Elektrik 4071 / ÖİV 4080). GİB şematronu
                // BOŞ TaxTypeCode'u reddettiğinden, kod hiç çözülemezse bu ek vergiyi
                // GÖNDERMEYİZ (faturanın tamamı reddedilmesin) ve uyarı loglarız.
                const otherCode = l.otherTaxCode || resolveOtherTaxCode(l.otherTaxName);
                if (otherCode) {
                    const entry: any = {
                        taxCode: otherCode,
                        taxRate: l.otherTaxRate,
                        taxAmount: l.otherTax,
                        taxableAmount: l.taxable,
                    };
                    // ÖİV (4080) hariç serbest adı da gönder (Swagger: KDV/ÖİV/ÖTV'de ad
                    // ayrıca yazılmaz). Konaklama/Elektrik'te ad GİB görselinde görünür.
                    if (l.otherTaxName && otherCode !== "4080") entry.taxName = l.otherTaxName;
                    extraTaxes.push(entry);
                } else {
                    console.warn(
                        `[Mysoft] Diğer Vergi GİB koduna çevrilemedi (ad="${l.otherTaxName ?? ""}"), GİB'e gönderilmiyor. Kalem: ${l.item?.description ?? ""}`,
                    );
                }
            }
            if (extraTaxes.length > 0) {
                detail.tax = extraTaxes;
            }
            return detail;
        })
      };


      // TASLAK PDF ÖNİZLEME modu: payload (Mysoft'un kabul ettiği tam model) hazır;
      // gönderim yerine getInvoiceOutboxDraftPdfAsZip'e verip filigranlı PDF alırız.
      // getInvoiceOutboxDraftPdfAsZip tam model ister — bu yüzden sendInvoice'ın
      // kurduğu payload'ı yeniden kullanıyoruz (ettn dışarıdan taslağınkiyle gelir).
      if (invoiceData.draftPdfOnly) {
        const draftBody = { ...payload, isSaveAsDraft: true, isPrintDraftWatermark: true }
        const pdfRes = await fetch(`${this.baseUrl}/api/InvoiceOutbox/getInvoiceOutboxDraftPdfAsZip`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${tokenData.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(draftBody),
        })
        const r = await pdfRes.json().catch(() => null)
        if (!r?.succeed || !r?.data) {
          return { success: false, error: r?.message || "Taslak PDF alınamadı." }
        }
        const pdf = await this.unzipFirstPdf(r.data)
        if (!pdf) return { success: false, error: "Zip içinde taslak PDF bulunamadı." }
        return { success: true, isPdf: true, pdfBuffer: pdf.pdfBuffer, filename: pdf.filename }
      }

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

      // HATA'da genel "Hata" etiketi işe yaramaz — asıl bilgi zarf mesajıdır
      // (ör. "GONDERILEN ZARF SISTEMDE DAHA ONCE KAYITLI OLAN BIR FATURAYI
      // ICERMEKTEDIR"). Kullanıcı ancak bunu görürse ne yapacağını bilir, bu yüzden
      // hata durumunda zarf metni etiketin ÖNÜNE geçer.
      const message =
        upper === "HATA"
          ? declineReason || envelopeStatusText || humanLabel[upper] || rawText || "Hata"
          : declineReason ||
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
        envelopeStatusText,
        envelopeStatusCode: result.data?.envelopeStatusCode ?? null,
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

      // SAYFALAMA ŞART: sayfasız uç (getInvoiceInboxWithHeaderInfoListForPeriod)
      // dönemde kaç fatura olursa olsun EN FAZLA 100 kayıt döndürür ve kalanı sessizce
      // keser. Kesilen kısım tam olarak EN YENİ faturalardır; bu yüzden yeni gelen
      // e-faturalar hiç senkronize olmuyor, gelen kutusu eski kayıtlarda donuyordu.
      // Paging ucu pageNumber (1'den başlar) + pageSize (max 1000) alır ve totalCount
      // döndürür; sayfa boş gelene ya da totalCount'a ulaşana kadar dönüyoruz.
      const url = `${this.baseUrl}/api/InvoiceInbox/getInvoiceInboxWithHeaderInfoListForPeriodPaging`
      const PAGE_SIZE = 500
      const MAX_PAGES = 40 // güvenlik freni — 20.000 kayıt
      const items: any[] = []
      let lastResult: any = null

      for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            startDate: start.toISOString(),
            endDate: end.toISOString(),
            pageNumber,
            pageSize: PAGE_SIZE,
          }),
        })

        const result = await res.json().catch(() => null)
        if (!result || result.succeed === false) {
          // İlk sayfa başarısızsa gerçek hata; sonraki sayfada patlarsa o ana kadar
          // toplananla devam etmek, senkronu tümden kaybetmekten iyidir.
          if (pageNumber === 1) {
            return {
              success: false,
              error: result?.message || `HTTP ${res.status}`,
              rawResponse: result,
            }
          }
          break
        }
        lastResult = result

        const page: any[] = Array.isArray(result.data)
          ? result.data
          : Array.isArray(result.data?.items)
            ? result.data.items
            : []
        items.push(...page)

        const total = Number(result.totalCount)
        if (page.length < PAGE_SIZE) break
        if (Number.isFinite(total) && items.length >= total) break
      }

      const result = lastResult

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
    // Kayıtlı kullanıcı adı/şifreyle otomatik giriş — token hâlâ geçerliyse
    // yeniden giriş yapmadan cache'ten kullan. Böylece her istekte tek bir
    // "giriş" yapılır; gereksiz oauth/token tekrarından ve olası
    // rate-limit / oturum geçersizleşmesinden kaçınılır.
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }
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
      // expires_in (saniye) varsa ona göre, yoksa 5 dk güvenli varsayımla cache'le.
      // Süre dolmadan 60 sn önce yenilemek için pay bırakılır.
      const expiresInSec = Number(tokenData.expires_in);
      const ttlMs =
        Number.isFinite(expiresInSec) && expiresInSec > 0
          ? Math.max(30_000, (expiresInSec - 60) * 1000)
          : 5 * 60_000;
      const accessToken: string = String(tokenData.access_token);
      this.cachedToken = accessToken;
      this.tokenExpiresAt = Date.now() + ttlMs;
      return accessToken;
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
          sender: {
            name: string | null
            taxNumber: string | null
            taxOffice: string | null
            address: string | null
            city: string | null
            district: string | null
          }
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
            otherTaxRate: number | null
            otherTaxAmount: number | null
            otherTaxName: string | null
            withholdingRate: number | null
            withholdingCode: string | null
            withholdingName: string | null
            lineTotal: number | null
          }>
          // Başlık toplamları satırlarla birebir tutmadığında (tevkifat/avans mahsubu)
          // kullanıcıya gösterilecek bilgilendirme notu. Matrahı bozmadan üretilir.
          reconcileNote?: string | null
          raw: any
        }
      }
    | { success: false; error: string; rawResponse?: any }
  > {
    try {
      const token = await this.getToken()
      if (!token) return { success: false, error: "Mysoft token alınamadı." }

      // Tenant (mükellef VKN) adaylarını sırayla dene. Mysoft, gönderilen
      // tenantIdentifierNumber login kullanıcısının firma-kullanıcı kaydıyla
      // eşleşmezse "Kullanıcı bilgileri ile firma kullanıcı kaydı bulunamadı"
      // döndürür. Kayıtlı firma VKN'si her zaman Mysoft login'inin gerçek
      // tenant'ıyla birebir aynı olmayabildiğinden — aynı (tek) giriş token'ıyla:
      //   1) firma/constructor VKN'si
      //   2) JWT token'ından keşfedilen GERÇEK tenant (login kullanıcısının)
      //   3) tenant parametresiz (login kullanıcısının varsayılan tenant'ı)
      // adaylarını deneyip Mysoft'un kabul ettiği ilk yanıtı kullanırız. Böylece
      // kullanıcı "VKN doğrula" adımına gerek kalmadan yalnızca kayıtlı kullanıcı
      // adı/şifresiyle giriş yaparak kalemleri otomatik çekebilir.
      const candidates: string[] = []
      const pushCandidate = (v: string | null | undefined) => {
        const val = typeof v === "string" && v.trim() ? v.trim() : ""
        if (!candidates.includes(val)) candidates.push(val)
      }
      pushCandidate(await this.resolveTenantVkn())
      try {
        const fromToken = await this.discoverTenantFromToken()
        if (fromToken.success) pushCandidate(fromToken.vknFromToken)
      } catch {
        // token'dan keşif başarısızsa diğer adaylarla devam et
      }
      pushCandidate("") // parametresiz — login kullanıcısının varsayılan tenant'ı

      const isFirmaUserError = (msg: unknown): boolean => {
        const low = String(msg || "").toLowerCase()
        return low.includes("firma kullanıcı") || low.includes("kullanıcı bilgileri")
      }

      let result: any = null
      let lastError = ""
      for (const tenant of candidates) {
        const url = new URL(`${this.baseUrl}/api/InvoiceInbox/getInvoiceInboxModel`)
        url.searchParams.set("invoiceETTN", uuid)
        if (tenant) url.searchParams.set("tenantIdentifierNumber", tenant)

        const res = await fetch(url.toString(), {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        })
        const body = await res.json().catch(() => null)
        if (body && body.succeed !== false) {
          result = body
          break
        }
        lastError = body?.message || `HTTP ${res.status}`
        // firma-kullanıcı hatasıysa sıradaki tenant adayını dene; başka bir hata
        // (ör. belge bulunamadı, yetki) ise adayları denemenin anlamı yok, çık.
        if (!isFirmaUserError(lastError)) {
          return { success: false, error: lastError, rawResponse: body }
        }
      }

      if (!result) {
        return { success: false, error: lastError || "Gelen fatura modeli alınamadı." }
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
      // Resmî şema: kalemler "detailList" altında (InvoiceForApiDetailModel[]).
      // Sürüm/varyant farkları için diğer olası anahtarları da deniyoruz.
      const rawLines: any[] =
        [
          model.detailList,
          model.invoiceLines,
          model.lines,
          model.items,
          model.invoiceDetail,
          model.detail,
        ].find((v: any) => Array.isArray(v) && v.length > 0) || []

      if (rawLines.length === 0) {
        // Kalem gelmediğinde editörde tek satırlık "Mal/Hizmet" placeholder'a düşülüyor.
        // Asıl nedeni (yanlış anahtar / boş yanıt) görebilmek için modelin anahtarlarını logla.
        console.warn(
          "[Mysoft] getIncomingInvoiceModel: kalem listesi BOŞ. model anahtarları:",
          model && typeof model === "object" ? Object.keys(model) : typeof model,
        )
      }

      const lines = rawLines.map((ln: any) => {
        // Stok bilgisi resmî şemada "detailItem" altında nested gelir; düz (flat)
        // dönen varyantlar için ln'in kendisine fallback yapıyoruz.
        const item = ln.detailItem && typeof ln.detailItem === "object" ? ln.detailItem : ln

        // ÖNEMLİ: Ürün adı (Stok Adı / itemName) önce gelmeli. Generic "name" /
        // "description" anahtarları Mysoft'ta satır açıklamasını taşıyabildiği için
        // önce onlara bakılırsa ürün adı ile açıklama yer değiştiriyordu.
        const productName = pick(item, "itemName", "productName", "name") as string | null
        const itemDesc = pick(item, "itemDescription", "description") as string | null
        // Mysoft şeması: itemName="Stok Adı", itemDescription="Stok Açıklaması",
        // sellersItemIdentificationId="Satıcı Kodu".
        const productCode = pick(
          item,
          "sellersItemIdentificationId",
          "sellersItemIdentification",
          "productCode",
          "itemCode",
        ) as string | null

        // Bazı göndericiler stok KODUNU hem "Satıcı Kodu"na hem "Stok Adı"na yazıp
        // asıl ürün adını "Stok Açıklaması"na koyuyor. Bu durumda itemName'i tercih
        // etmek, kalemi hem Kod hem Açıklama kolonunda aynı kodla gösteriyordu
        // (ör. Kod ve Açıklama = "153 43KLM FIN 0120"; gerçek ad "FİNLUX FIN 12000
        // A++ İNVERTER KLİMA" kayboluyordu). Ad kodun aynısıysa açıklamaya düşüyoruz —
        // GİB görüntüsündeki "Malzeme/Hizmet Açıklaması" kolonuyla aynı davranış.
        const normalizeText = (v: string | null) =>
          (v || "").replace(/\s+/g, " ").trim().toLocaleUpperCase("tr")
        const nameIsJustCode =
          Boolean(productName) &&
          Boolean(productCode) &&
          normalizeText(productName) === normalizeText(productCode)
        const lineDescription = nameIsJustCode
          ? itemDesc || productName || null
          : productName || itemDesc || null

        // İskonto: allowanceChargeList[].chargeIndicator === false (iskonto).
        // multiplierFactorNumeric oran olarak 0..1 gelir → %'ye çeviriyoruz.
        const allowances: any[] = Array.isArray(ln.allowanceChargeList)
          ? ln.allowanceChargeList
          : []
        const discount =
          allowances.find((a) => a?.chargeIndicator === false) || allowances[0] || null
        let discountRate =
          discount && discount.multiplierFactorNumeric != null
            ? (num(discount.multiplierFactorNumeric) ?? 0) * 100
            : num(pick(ln, "discountRate", "allowanceChargeRate"))
        let discountAmount = discount
          ? num(discount.amount)
          : num(pick(ln, "discountAmount", "allowanceChargeAmount", "allowanceTotalAmount"))

        // KDV: taxTotal.taxSubtotalList[].percent (resmî şema, object). Flat varyantlar
        // için doğrudan ln üzerindeki alanlara düşeriz.
        const taxTotalObj =
          ln.taxTotal && typeof ln.taxTotal === "object" && !Array.isArray(ln.taxTotal)
            ? ln.taxTotal
            : null
        const subList: any[] =
          taxTotalObj && Array.isArray(taxTotalObj.taxSubtotalList)
            ? taxTotalObj.taxSubtotalList
            : []
        // KDV alt-toplamı GİB vergi kodu "0015" ile gelir. Kod hiç yoksa (eski/flat
        // varyant) ilk alt-toplamı KDV kabul ederiz (eski davranış korunur).
        const anyTaxCode = subList.some(
          (s) => s && s.taxTypeCode != null && String(s.taxTypeCode).trim() !== "",
        )
        const taxSub = anyTaxCode
          ? subList.find((s) => String(s?.taxTypeCode ?? "").trim() === "0015") ||
            subList[0] ||
            null
          : subList[0] || null
        // KDV DIŞI satır vergileri = "Diğer Vergiler" (ör. Konaklama Vergisi %1).
        // Matrahın üzerine eklenen ek vergilerdir; editördeki ayrı "Diğer Vergi" alanına
        // taşınır. Önceden yalnız taxSubtotalList[0] (KDV) alındığı için bu vergiler
        // tamamen düşüyordu → alış tutarı eksik çıkıyordu.
        const otherSubs = subList.filter(
          (s) => s && s !== taxSub && (num(s.taxAmount) ?? 0) !== 0,
        )
        const vatAmount = taxSub
          ? num(taxSub.taxAmount)
          : taxTotalObj
            ? num(taxTotalObj.taxAmount)
            : num(pick(ln, "vatAmount", "taxAmount", "taxTotalTra"))

        const quantity = num(pick(ln, "invoicedQuantity", "quantity"))
        let unitPrice = num(pick(ln, "unitPrice", "priceAmount", "price"))
        const lineTotal = num(pick(ln, "lineExtensionAmount", "lineTotal", "amountTra"))
        let vatRate = taxSub
          ? num(taxSub.percent)
          : num(pick(ln, "vatRate", "taxRate", "taxPercent"))

        // Diğer vergilerin toplamı + adı + oranı. Tek diğer-vergi varsa alt-toplamın
        // kendi percent'ini kullan; yoksa/çoklu ise oranı aşağıda net tutardan türet.
        const otherTaxAmount =
          otherSubs.length > 0
            ? otherSubs.reduce((sum, s) => sum + (num(s.taxAmount) ?? 0), 0)
            : null
        // Diğer verginin ADI: önce Mysoft'un verdiği taxName, yoksa GİB vergi
        // kodundan türet, o da yoksa kodu göster. "Hangi vergi kaleminden" olduğunu
        // kullanıcıya net göstermek için ad boş bırakılmaz.
        const otherTaxCode =
          otherSubs.length > 0
            ? (pick(otherSubs[0], "taxTypeCode", "taxCode") as string | null)
            : null
        const otherTaxName =
          otherSubs.length > 0
            ? ((pick(otherSubs[0], "taxName") as string | null) ||
                resolveOtherTaxName(otherTaxCode))
            : null
        let otherTaxRate = otherSubs.length === 1 ? num(otherSubs[0].percent) : null

        // Mysoft bazı fatura tiplerinde (özellikle iskontolu / e-Arşiv) satır BİRİM
        // FİYATINI boş/0 döndürüp yalnız net satır tutarını (lineExtensionAmount) veriyor.
        // Editör kalem net'ini qty×birimFiyat−iskonto ile yeniden hesapladığından, birim
        // fiyat 0 olunca tüm satır "0 TL" çıkıyor. Bu durumda net satır tutarını taban alıp
        // (unitPrice = net/qty) ayrı iskonto alanlarını sıfırlıyoruz: iskonto zaten net'e
        // gömülü olduğundan editörün yeniden hesabı net ile bire bir tutar (yüzde/tutar
        // modu belirsizliğinden kaçınırız). UBL toplu içe aktarıcıdaki fallback ile aynı fikir.
        if (
          (unitPrice == null || unitPrice <= 0) &&
          lineTotal != null && lineTotal > 0 &&
          quantity != null && quantity > 0
        ) {
          unitPrice = lineTotal / quantity
          discountRate = 0
          discountAmount = 0
        }
        // KDV oranı gelmediyse ama KDV tutarı + net satır tutarı varsa orandan türet.
        if (vatRate == null && vatAmount != null && lineTotal != null && lineTotal > 0) {
          vatRate = Math.round((vatAmount / lineTotal) * 100)
        }
        // Diğer vergi oranı alt-toplamdan gelmediyse tutar / net satır tutarından türet
        // (2 ondalık). Editör "Diğer Vergi = net × oran/100" ile yeniden hesapladığı için
        // bu oran net ile birebir aynı ek vergi tutarını verir.
        if (
          otherTaxRate == null &&
          otherTaxAmount != null && otherTaxAmount !== 0 &&
          lineTotal != null && lineTotal > 0
        ) {
          otherTaxRate = Math.round((otherTaxAmount / lineTotal) * 10000) / 100
        }

        return {
          description: lineDescription,
          productCode,
          // UBL/GİB birim kodunu (ör. C62→ADET, MTR→MT) uygulama birimine çevir.
          unit:
            normalizeUnitCode(pick(ln, "unitCode", "unit", "quantityUnitCode") as string | null) ||
            null,
          quantity,
          unitPrice,
          discountRate,
          discountAmount,
          vatRate,
          vatAmount,
          otherTaxRate,
          otherTaxAmount,
          otherTaxName,
          // KDV tevkifatı (varsa detailList'ten; yoksa aşağıda başlık invoiceType=TEVKIFAT
          // reconciliation'ında hesaplanır). withholdingRate = tevkif edilen KDV yüzdesi.
          withholdingRate: num(pick(ln, "withholdingTaxPercentage", "withholdingRate")),
          withholdingCode: pick(ln, "withholdingTaxTypeCode", "withholdingCode") as string | null,
          withholdingName: pick(ln, "withholdingTaxTypeName", "withholdingName") as string | null,
          lineTotal,
        }
      })

      // Tam model (InvoiceForApiModel) toplamları legalMonetaryTotal altında NESTED,
      // KDV ise taxTotal[] dizisinde gelir. Özet/flat varyantta ise top-level'dedir.
      // Önce top-level pick, yoksa nested değere düş. Aksi halde kalem gelmeyen
      // faturalarda placeholder tutarı (data.taxExclusiveAmount) null → editörde 0/boş çıkıyordu.
      const lmt =
        model.legalMonetaryTotal && typeof model.legalMonetaryTotal === "object"
          ? model.legalMonetaryTotal
          : null
      const headerVat = Array.isArray(model.taxTotal)
        ? model.taxTotal.reduce((s: number, t: any) => s + (num(t?.taxAmount) ?? 0), 0)
        : null

      // BAŞLIK-VERGİLİ FATURALAR (elektrik/telekom vb.): Bazı faturalarda kalemlerin
      // KENDİ vergisi yoktur (detailList[].taxTotal = null → satır vatRate null) ve TÜM
      // vergi fatura BAŞLIĞINDA (taxTotal[]) gelir. Ayrıca KDV matrahı, satır net
      // toplamından büyük olabilir çünkü KDV DIŞI ama KDV MATRAHINA DAHİL vergiler
      // (ör. Elektrik Tüketim Vergisi / BTV, kod 4071) vardır. Bu durumda editör satırdan
      // yeniden hesaplayınca hem oranı hem matrahı kaçırıp tutarı EKSİK/YANLIŞ üretiyordu.
      // Düzeltme: (1) vergisiz satırlara başlıktaki KDV oranını ata, (2) KDV matrahı ile
      // satır net toplamı farkını (matraha dahil ek vergiler) ADI korunarak sentetik bir
      // satır olarak ekle → dönüştürülen alış faturasının matrah/KDV/toplamı orijinalle tutar.
      const headerSubs: any[] =
        Array.isArray(model.taxTotal) &&
        model.taxTotal[0] &&
        Array.isArray(model.taxTotal[0].taxSubtotalList)
          ? model.taxTotal[0].taxSubtotalList
          : []
      const kdvSubs = headerSubs.filter((s) => String(s?.taxTypeCode ?? "").trim() === "0015")
      const kdvSubHeader = kdvSubs.length === 1 ? kdvSubs[0] : null
      const linesHaveNoTax =
        lines.length > 0 &&
        lines.every((l) => l.vatRate == null && (l.vatAmount == null || l.vatAmount === 0))
      if (kdvSubHeader && linesHaveNoTax) {
        const kdvRate = num(kdvSubHeader.percent)
        const kdvBase = num(kdvSubHeader.taxableAmount)
        if (kdvRate != null) {
          for (const l of lines) if (l.vatRate == null) l.vatRate = kdvRate
          const lineNetSum = lines.reduce(
            (s, l) => s + (num(l.lineTotal) ?? (num(l.quantity) ?? 0) * (num(l.unitPrice) ?? 0)),
            0,
          )
          if (kdvBase != null && kdvBase - lineNetSum > 0.01) {
            const gap = Math.round((kdvBase - lineNetSum) * 100) / 100
            const extraName =
              headerSubs
                .filter(
                  (s) =>
                    String(s?.taxTypeCode ?? "").trim() !== "0015" && (num(s.taxAmount) ?? 0) > 0,
                )
                .map(
                  (s) =>
                    (pick(s, "taxName") as string) ||
                    resolveOtherTaxName(pick(s, "taxTypeCode") as string),
                )
                .filter(Boolean)
                .join(" + ") || "Matraha Dahil Diğer Vergiler"
            lines.push({
              description: extraName,
              productCode: null,
              unit: null,
              quantity: 1,
              unitPrice: gap,
              discountRate: null,
              discountAmount: null,
              vatRate: kdvRate,
              vatAmount: null,
              otherTaxRate: null,
              otherTaxAmount: null,
              otherTaxName: null,
              withholdingRate: null,
              withholdingCode: null,
              withholdingName: null,
              lineTotal: gap,
            })
          }
        }
      }

      // ---------------------------------------------------------------------
      // BAŞLIK TOPLAMI RECONCILIATION — "Diğer Vergiler" (ÖİV vb.) + tevkifat notu
      // ---------------------------------------------------------------------
      // Gelen faturanın RESMÎ başlık toplamları (taxExclusive/taxInclusive/payable +
      // KDV kırılımı) her zaman doğrudur. Editör satır ORANLARINDAN yeniden hesapladığı
      // için, KDV MATRAHINA girmeyen ama toplama EKLENEN vergiler (Özel İletişim
      // Vergisi/ÖİV, Konaklama Vergisi vb.) satır alt-toplamlarında gelmediğinde tamamen
      // düşüyor ve alış faturası tutarı EKSİK çıkıyordu (telekom faturaları — Vodafone/
      // Türk Telekom/NetGSM). Burada başlık kırılımından eksik "diğer vergi"yi hesaplayıp
      // satırlara PAY olarak dağıtıyoruz → dönüştürülen faturanın "vergiler dâhil" toplamı
      // orijinalle KURUŞU KURUŞUNA tutuyor. Matrah ve KDV asla bozulmaz.
      let reconcileNote: string | null = null
      const r2 = (x: number) => Math.round(x * 100) / 100
      const hNet =
        num(pick(model, "taxExclusiveAmount", "amtTra", "netAmount")) ??
        (lmt ? num(pick(lmt, "taxExclusiveAmount", "lineExtensionAmount")) : null)
      const hInclusive =
        num(pick(model, "taxInclusiveAmount")) ?? (lmt ? num(pick(lmt, "taxInclusiveAmount")) : null)
      const hPayable =
        num(pick(model, "payableAmount", "payableAmountTra", "totalAmount")) ??
        (lmt ? num(pick(lmt, "payableAmount", "taxInclusiveAmount")) : null)
      const hRounding =
        num(pick(model, "payableRoundingAmount")) ??
        (lmt ? num(pick(lmt, "payableRoundingAmount")) : null) ??
        0
      // Brüt KDV: önce flat vatTotalTraNN (NN = oran) toplamı — en güvenilir; yoksa
      // taxTotal[] içindeki 0015 (KDV) alt-toplamları; yoksa headerVat (son çare).
      let hKdv = 0
      let flatKdvSeen = false
      let dominantKdvRate: number | null = null
      let dominantKdvBase = -1
      for (const k of Object.keys(model)) {
        const mm = /^vatTotalTra(\d+)$/.exec(k)
        if (!mm) continue
        const v = num((model as any)[k]) ?? 0
        if (v === 0) continue
        hKdv += v
        flatKdvSeen = true
        const base = num((model as any)[`taxableVatTotalTra${mm[1]}`]) ?? 0
        if (base > dominantKdvBase) {
          dominantKdvBase = base
          dominantKdvRate = Number(mm[1])
        }
      }
      if (!flatKdvSeen) {
        const kdvFromSubs = headerSubs
          .filter((s) => String(s?.taxTypeCode ?? "").trim() === "0015")
          .reduce((acc, sub) => acc + (num(sub.taxAmount) ?? 0), 0)
        hKdv = kdvFromSubs || headerVat || 0
        if (kdvSubHeader) dominantKdvRate = num(kdvSubHeader.percent)
      }
      // "Diğer vergi" adı: başlık alt-toplamlarındaki KDV DIŞI kalemlerden türet
      // (ör. Özel İletişim Vergisi), yoksa genel ad.
      const headerOtherName =
        headerSubs
          .filter(
            (s) => String(s?.taxTypeCode ?? "").trim() !== "0015" && (num(s.taxAmount) ?? 0) !== 0,
          )
          .map((s) => (pick(s, "taxName") as string) || resolveOtherTaxName(pick(s, "taxTypeCode") as string))
          .filter(Boolean)
          .join(" + ") || "Diğer Vergiler"

      if (hInclusive != null && hInclusive > 0) {
        // Kalem hiç gelmediyse başlıktan tek satırlık GERÇEK kalem kur (net + KDV);
        // diğer vergi aşağıda residual olarak eklenir. Böylece kalemsiz telekom
        // faturaları da tam tutar.
        if (lines.length === 0 && hNet != null && hNet > 0) {
          lines.push({
            description: "Mal/Hizmet",
            productCode: null,
            unit: null,
            quantity: 1,
            unitPrice: hNet,
            discountRate: null,
            discountAmount: null,
            vatRate: dominantKdvRate ?? (hKdv > 0 ? r2((hKdv / hNet) * 100) : 20),
            vatAmount: hKdv > 0 ? hKdv : null,
            otherTaxRate: null,
            otherTaxAmount: null,
            otherTaxName: null,
            withholdingRate: null,
            withholdingCode: null,
            withholdingName: null,
            lineTotal: hNet,
          })
        }

        const lineNetOf = (l: any): number =>
          num(l.lineTotal) ??
          (num(l.quantity) ?? 0) * (num(l.unitPrice) ?? 0) - (num(l.discountAmount) ?? 0)
        const lineNetSum = lines.reduce((acc, l) => acc + (lineNetOf(l) || 0), 0)
        // Editörün MEVCUT satırlardan yeniden kuracağı "vergiler dâhil" toplam
        // (net + KDV + halihazırdaki diğer vergi). Reconciliation'ı bu GERÇEK yeniden
        // kurulum üzerinden yaparız; matrah/KDV-baz varsayımı yapmayız.
        const reconstructed = lines.reduce((acc, l) => {
          const n = lineNetOf(l) || 0
          return acc + n + n * ((num(l.vatRate) ?? 0) / 100) + n * ((num(l.otherTaxRate) ?? 0) / 100)
        }, 0)
        // Eksik kalan = matraha GİRMEYEN, toplama eklenen vergiler (ÖİV, konaklama, BSMV…).
        // ÖNEMLİ: Matraha DÂHİL vergilerde (elektrik BTV, gazoz ÖTV) satır neti zaten
        // KDV matrahını içerdiğinden yeniden-kurulum orijinal toplama ulaşır → residual≈0,
        // yani ÇİFT SAYIM OLMAZ. Yalnızca gerçekten üste eklenen vergi kadar tamamlanır.
        const residual = r2(hInclusive - reconstructed)
        if (residual > 0.02 && lineNetSum > 0) {
          // Net oranında PAY dağıt; ORANI YUVARLAMA (büyük matrahta drift olmasın),
          // yuvarlama kalanını son satıra ver → toplam kuruşu kuruşuna tutar.
          let distributed = 0
          lines.forEach((l, i) => {
            const n = lineNetOf(l) || 0
            if (n <= 0) return
            const isLast = i === lines.length - 1
            const share = isLast ? r2(residual - distributed) : r2(residual * (n / lineNetSum))
            if (!isLast) distributed += share
            l.otherTaxRate = (num(l.otherTaxRate) ?? 0) + (share / n) * 100
            l.otherTaxAmount = (num(l.otherTaxAmount) ?? 0) + share
            if (!l.otherTaxName) l.otherTaxName = headerOtherName
          })
        } else if (residual < -0.02) {
          // Satır vergileri, faturanın RESMÎ vergiler-dâhil toplamını AŞIYOR. Bu ancak kaynak
          // veri tutarsızsa olur (ör. KDV istisnalı satıra oran gelmesi). Sessizce yanlış tutar
          // üretmemek için kullanıcıyı uyarırız; matrahı otomatik değiştirmeyiz.
          const curr = (pick(model, "currencyCode", "currency") as string) || "TL"
          reconcileNote =
            `Dikkat: hesaplanan kalem vergileri, faturanın resmî vergiler-dâhil toplamını ` +
            `(${hInclusive.toFixed(2)} ${curr}) aşıyor. Kalem KDV/vergi oranlarını kaynak ` +
            `faturayla karşılaştırıp elle düzeltin.`
        }

        // Tevkifat / avans mahsubu: ödenecek < vergiler dâhil.
        const hWithholding = r2(hInclusive - (hPayable ?? hInclusive) + (hRounding ?? 0))
        if (hWithholding > 0.02) {
          const invoiceType = String(pick(model, "invoiceType", "documentType") ?? "").toUpperCase()
          const curr = (pick(model, "currencyCode", "currency") as string) || "TL"
          // Satırlarda (detailList'ten) zaten tevkifat geldiyse tekrar uygulama.
          const alreadyWithheld = lines.reduce(
            (acc, l) =>
              acc +
              (lineNetOf(l) || 0) *
                ((num(l.vatRate) ?? 0) / 100) *
                ((num(l.withholdingRate) ?? 0) / 100),
            0,
          )
          // GERÇEK KDV tevkifatı: invoiceType=TEVKIFAT ve tevkif edilen ≤ toplam KDV.
          // (Vodafone gibi avans/mahsup — invoiceType=SATIS veya fark>KDV — buraya GİRMEZ,
          // matrahı bozmadan not olarak kalır.)
          if (invoiceType === "TEVKIFAT" && hKdv > 0 && hWithholding <= hKdv + 0.02 && alreadyWithheld < 0.02) {
            // Tevkif edilen KDV'yi satırlara ORAN olarak uygula: withRate = tevkifat / toplam KDV.
            // Editör/kayıt: Σ (satırKDV × withRate/100) = tevkifat → ödenecek tutar orijinalle tutar.
            const withRate = (Math.min(hWithholding, hKdv) / hKdv) * 100
            for (const l of lines) {
              const lv = (lineNetOf(l) || 0) * ((num(l.vatRate) ?? 0) / 100)
              if (lv > 0) {
                l.withholdingRate = withRate
                if (!l.withholdingName) l.withholdingName = "KDV Tevkifatı"
              }
            }
          } else {
            reconcileNote =
              `Kaynak faturada vergiler dâhil toplam ${hInclusive.toFixed(2)} ${curr}, ödenecek ` +
              `${(hPayable ?? hInclusive).toFixed(2)} ${curr} (aradaki ${hWithholding.toFixed(2)} ${curr} ` +
              `avans/mahsup farkıdır). Fatura matrahı ve KDV'si korunmuştur.`
          }
        }
      }

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
            taxOffice: pick(
              model,
              "accountTaxOfficeName",
              "senderTaxOffice",
              "taxOfficeName",
              "taxOffice",
            ) as string | null,
            // Adres tek alan olarak gelmezse sokak/bina bileşenlerinden birleştir.
            address:
              (pick(model, "senderAddress", "address") as string | null) ||
              [
                pick(model, "accountStreetName", "streetName"),
                pick(model, "accountBuildingName", "buildingName"),
                pick(model, "accountBuildingNumber", "buildingNumber"),
              ]
                .filter((p) => p != null && String(p).trim() !== "")
                .join(" ") ||
              null,
            city: pick(model, "accountCityName", "senderCity", "cityName", "city") as string | null,
            district: pick(
              model,
              "accountDistrict",
              "accountCitySubdivisionName",
              "accountCitySubdvisionName",
              "citySubdivisionName",
              "district",
            ) as string | null,
          },
          totalAmount:
            num(pick(model, "payableAmount", "totalAmount", "payableAmountTra")) ??
            (lmt ? num(pick(lmt, "payableAmount", "taxInclusiveAmount")) : null),
          taxExclusiveAmount:
            num(pick(model, "taxExclusiveAmount", "amtTra", "netAmount")) ??
            (lmt ? num(pick(lmt, "taxExclusiveAmount", "lineExtensionAmount")) : null),
          taxInclusiveAmount:
            num(pick(model, "taxInclusiveAmount")) ??
            (lmt ? num(pick(lmt, "taxInclusiveAmount")) : null),
          vatAmount:
            num(pick(model, "taxTotalTra", "vatAmount", "totalVatAmount")) ??
            (headerVat && headerVat > 0 ? headerVat : null),
          lines,
          reconcileNote,
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

  /**
   * Gelen e-faturanın GİB HTML görüntüsü (XSLT ile üretilmiş resmî görünüm).
   *
   * Swagger v8: GET /api/InvoiceInbox/getInvoiceInboxHTMLAsZip?invoiceETTN={uuid}
   * Yanıt: StringResultModel { data: base64-zip } — zip içinde .html dosyası.
   *
   * PDF'in alınamadığı (ör. Mysoft tarafında PDF üretilmemiş) faturalarda gelen
   * belgenin gerçek görüntüsünü almanın ikinci yolu budur.
   *
   * DİKKAT: Dönen HTML gönderen tarafın içeriğidir — güvenilmez kabul edilmeli,
   * sandbox'lanmadan kendi origin'imizde çalıştırılmamalıdır.
   */
  async getIncomingInvoiceHtml(
    uuid: string,
  ): Promise<{ success: true; html: string } | { success: false; error: string }> {
    try {
      const token = await this.getToken()
      if (!token) return { success: false, error: "Mysoft token alınamadı." }

      const url = new URL(`${this.baseUrl}/api/InvoiceInbox/getInvoiceInboxHTMLAsZip`)
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
        return { success: false, error: result?.message || "HTML alınamadı." }
      }

      const zipBuffer = Buffer.from(result.data, "base64")
      const JSZip = (await import("jszip")).default
      const zip = await JSZip.loadAsync(zipBuffer)
      const htmlEntry = Object.values(zip.files).find(
        (f) => !f.dir && /\.x?html?$/i.test(f.name),
      )
      if (!htmlEntry) return { success: false, error: "Zip içinde HTML bulunamadı." }
      return { success: true, html: await htmlEntry.async("string") }
    } catch (error: any) {
      return { success: false, error: error?.message || "HTML indirilirken hata oluştu." }
    }
  }

  // base64-zip → içindeki ilk PDF'i Buffer olarak çıkarır. Resmî (getInvoicePdf) ve
  // taslak (getDraftInvoicePdf) PDF'leri ortak kullanır — GİB PDF'leri hep zip içinde döner.
  private async unzipFirstPdf(base64Zip: string): Promise<{ pdfBuffer: Buffer; filename: string } | null> {
    const zipBuffer = Buffer.from(base64Zip, "base64");
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(zipBuffer);
    const pdfEntry = Object.values(zip.files).find((f) => !f.dir && f.name.toLowerCase().endsWith(".pdf"));
    if (!pdfEntry) return null;
    const pdfBuffer = await pdfEntry.async("nodebuffer");
    // GİB zip'i içindeki PDF, resmî belge adıyla gelir (klasör yolu olmadan al).
    const filename = pdfEntry.name.split("/").pop() || pdfEntry.name;
    return { pdfBuffer, filename };
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

      const pdf = await this.unzipFirstPdf(result.data);
      if (!pdf) return { success: false, error: "Zip içinde PDF bulunamadı." };
      return { success: true, pdfBuffer: pdf.pdfBuffer, filename: pdf.filename };
    } catch (error: any) {
      return { success: false, error: error?.message || "PDF indirilirken hata oluştu." };
    }
  }

  /**
   * TASLAK giden faturayı GİB'e gönderir (kesinleştirme). Swagger v8:
   * POST /api/InvoiceOutbox/sendDraftInvoiceToGIB (SendDraftInvoiceRequestModel).
   * ettn = taslak oluştururken kaydedilen ETTN'dir (biz üretip payload.ettn ile göndermiştik).
   */
  async sendDraftToGib(params: {
    ettn: string;
    prefix?: string;
    tenantIdentifierNumber?: string;
    connectorGuid?: string;
  }): Promise<{ success: boolean; error?: string; message?: string; docNo?: string }> {
    try {
      const token = await this.getToken();
      if (!token) return { success: false, error: "Mysoft token alınamadı." };

      const body: any = {
        ettn: params.ettn,
        ...(params.prefix ? { prefix: params.prefix } : {}),
        ...(params.tenantIdentifierNumber ? { tenantIdentifierNumber: params.tenantIdentifierNumber } : {}),
        ...(params.connectorGuid ? { connectorGuid: params.connectorGuid } : {}),
      };

      const res = await fetch(`${this.baseUrl}/api/InvoiceOutbox/sendDraftInvoiceToGIB`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const result = await res.json();
      if (!result?.succeed) {
        return { success: false, error: result?.message || "Taslak gönderilemedi." };
      }
      const data = (result && typeof result.data === "object" && result.data !== null) ? result.data : result;
      const rawDocNo = data?.docNo ?? data?.documentNo ?? data?.invoiceNo;
      const docNo = typeof rawDocNo === "string" && rawDocNo.trim() ? rawDocNo.trim() : undefined;
      return { success: true, message: result?.message, docNo };
    } catch (error: any) {
      return { success: false, error: error?.message || "Taslak gönderilirken hata oluştu." };
    }
  }

  /**
   * TASLAK giden faturayı siler (kullanıcı taslağı geri alıp yeniden düzenlemek isterse).
   * Swagger v8: GET /api/InvoiceOutbox/deleteDraftInvoiceOutbox?invoiceETTN=&tenantIdentifierNumber=
   */
  async deleteDraft(params: {
    ettn: string;
    tenantIdentifierNumber?: string;
  }): Promise<{ success: boolean; error?: string; message?: string }> {
    try {
      const token = await this.getToken();
      if (!token) return { success: false, error: "Mysoft token alınamadı." };

      const url = new URL(`${this.baseUrl}/api/InvoiceOutbox/deleteDraftInvoiceOutbox`);
      url.searchParams.set("invoiceETTN", params.ettn);
      if (params.tenantIdentifierNumber) url.searchParams.set("tenantIdentifierNumber", params.tenantIdentifierNumber);

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      const result = await res.json();
      if (!result?.succeed) {
        return { success: false, error: result?.message || "Taslak silinemedi." };
      }
      return { success: true, message: result?.message };
    } catch (error: any) {
      return { success: false, error: error?.message || "Taslak silinirken hata oluştu." };
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
   * GİB tevkifat kod listesini döner (kod + ad + oran).
   * Swagger v8: GET /api/GeneralCard/withholdingTaxType → WithholdingTaxTypeModelListResultModel
   *
   * Parametre almaz; oturum açan kullanıcının erişebildiği tüm tanımlı tevkifat
   * türlerini verir. `rate` KDV'nin yüzdesidir (ör. "50" = hesaplanan KDV'nin
   * %50'si alıcı tarafından tevkif edilir). Kod 650 ("diğer") oranı serbesttir;
   * o satırda oran fatura ekranından girilir.
   */
  async listWithholdingTaxTypes(): Promise<{
    success: boolean
    data?: Array<{ code: string; name: string; rate: number }>
    error?: string
  }> {
    try {
      const token = await this.getToken()
      if (!token) return { success: false, error: "Mysoft token alınamadı." }

      const res = await fetch(`${this.baseUrl}/api/GeneralCard/withholdingTaxType`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      })

      const result = await res.json()
      if (!result?.succeed) {
        return { success: false, error: result?.message || "Tevkifat listesi alınamadı." }
      }
      const raw: any[] = Array.isArray(result.data) ? result.data : []
      // Oran formatı tenant/sürüme göre değişebiliyor: "50" (yüzde), "33,33"
      // (virgüllü), ya da "4/10"/"9/10" (kesir). Hepsini yüzdeye normalize et.
      // Mysoft tevkifat oranını "40/10" (=%40), "90/10" (=%90) biçiminde döndürür:
      // PAY doğrudan tevkif edilen KDV yüzdesidir, payda (10) sabit ölçek artığıdır.
      // Bazı kayıtlar düz "50" / "33,33" de gelebilir — onu da destekle.
      const parseRate = (rawRate: any): number => {
        const s = String(rawRate ?? "").trim()
        if (!s) return 0
        const n = Number((s.includes("/") ? s.split("/")[0] : s).replace(",", "."))
        return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
      }
      const data = raw
        .map((w) => ({
          code: String(w?.withholdingTaxTypeCode ?? "").trim(),
          name: String(w?.withholdingTaxTypeName ?? "").trim(),
          // Alan adı varyantlarına da bak (rate / withholdingTaxPercentage / percent / ratio).
          rate: parseRate(w?.rate ?? w?.withholdingTaxPercentage ?? w?.percent ?? w?.ratio),
        }))
        .filter((w) => w.code)
      return { success: true, data }
    } catch (error: any) {
      return { success: false, error: error?.message || "Bilinmeyen bir hata oluştu." }
    }
  }

  /**
   * GİB vergi türü kod listesini döner (ÖTV listeleri + diğer vergiler; kod + ad + varsa oran).
   *
   * DİKKAT: Bu uç Swagger v8'de YOKTUR — `withholdingTaxType` ile aynı adlandırma
   * düzenine göre yoklanır (probe). Mysoft ileride `GET /api/GeneralCard/taxType`
   * eklerse liste otomatik akmaya başlar; bugün 404/başarısız döner ve çağıran
   * (/api/e-donusum/tax-types) gömülü GİB UBL-TR listesine düşer. Bu yüzden
   * başarısızlık burada beklenen bir sonuçtur, hata loglanmaz.
   */
  async listTaxTypes(): Promise<{
    success: boolean
    data?: Array<{ code: string; name: string; rate?: number }>
    error?: string
  }> {
    try {
      const token = await this.getToken()
      if (!token) return { success: false, error: "Mysoft token alınamadı." }

      const res = await fetch(`${this.baseUrl}/api/GeneralCard/taxType`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      })

      // Uç mevcut değilse 404 gövdesi JSON olmayabilir — sessizce başarısız say.
      const result = await res.json().catch(() => null)
      if (!res.ok || !result?.succeed) {
        return { success: false, error: result?.message || "Vergi türü listesi alınamadı." }
      }
      const raw: any[] = Array.isArray(result.data) ? result.data : []
      // Tevkifat oranıyla aynı biçim varyantları: "10", "33,33", "4/10" → yüzdeye çevir.
      const parseRate = (rawRate: any): number => {
        const s = String(rawRate ?? "").trim()
        if (!s) return 0
        const n = Number((s.includes("/") ? s.split("/")[0] : s).replace(",", "."))
        return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
      }
      const data = raw
        .map((t) => {
          const rate = parseRate(t?.rate ?? t?.taxRate ?? t?.percent ?? t?.ratio)
          return {
            code: String(t?.taxTypeCode ?? t?.code ?? "").trim(),
            name: String(t?.taxTypeName ?? t?.name ?? t?.description ?? "").trim(),
            rate: rate > 0 ? rate : undefined,
          }
        })
        // GİB vergi türü kodları 4 haneli sayıdır ("0059", "9077"...). Belgesiz uçtan
        // beklenmedik veri gelirse (farklı semantik) seçiciyi kirletmesin diye ele.
        .filter((t) => /^\d{4}$/.test(t.code) && t.name)
      return { success: true, data }
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