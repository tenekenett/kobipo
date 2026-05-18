import { EInvoiceProvider } from "./types"

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
    this.baseUrl = config.baseUrl || "https://edocumentapi.mytest.tr";
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

      // 0 tutarlı kalemleri Mysoft'a göndermiyoruz
      const lineData = (invoiceData.items as any[])
        .map((item: any) => {
          const qty = Number(item.quantity) || 0;
          const unitPrice = Number(item.unitPrice) || 0;
          const vatRate = Number(item.vatRate) || 0;
          const rowTotal = qty * unitPrice;
          const rowVat = (rowTotal * vatRate) / 100;
          const exemptionCode = typeof item.taxExemptionReasonCode === "string" && item.taxExemptionReasonCode.trim()
            ? item.taxExemptionReasonCode.trim()
            : null;
          const exemptionReason = typeof item.taxExemptionReason === "string" && item.taxExemptionReason.trim()
            ? item.taxExemptionReason.trim()
            : null;
          return { item, qty, unitPrice, vatRate, rowTotal, rowVat, exemptionCode, exemptionReason };
        })
        .filter((l: any) => l.rowTotal > 0);

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
      const initialProfile = isEFatura ? "TICARIFATURA" : "EARSIVFATURA"
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
      //  2) Yoksa Mysoft'un /createInvoiceOutboxTestJson endpoint'inden hesabın
      //     varsayılan prefix'ini öğren ve kullan (Mysoft Tenant API'si müşteri tarafında yok,
      //     ama bu örnek payload endpoint'i hesaba özel prefix'i döner).
      const explicitPrefix = typeof invoiceData.prefix === "string" && invoiceData.prefix.trim()
        ? invoiceData.prefix.trim().toUpperCase()
        : null
      let resolvedPrefix = explicitPrefix
      if (!resolvedPrefix) {
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
        "isManuelCalculation": false,

        "invoiceAccount": {
            "accountName": invoiceData.customer?.name || "Son Kullanıcı",
            "vknTckn": rawVkn,
            "taxOfficeName": invoiceData.customer?.taxOffice || "Vergi Dairesi",
            "countryName": "TÜRKİYE",
            "cityName": invoiceData.customer?.city || "DENİZLİ",
            "citySubdivision": "PAMUKKALE",
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
                amtTra: l.rowTotal,
                taxableAmtTra: l.rowTotal,
                vatRate: l.vatRate,
                amtVatTra: l.rowVat,
            };
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

      return { success: true, uuid: rawUuid };

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
      };

    } catch (error: any) {
      return { success: false, error: error.message || "Bilinmeyen bir hata oluştu." };
    }
  }

  async getIncomingInvoices(params: any): Promise<any[]> {
    return [];
  }

  private async getToken(): Promise<string | null> {
    const tokenRes = await fetch(`${this.baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: this.username,
        password: this.passwordText,
        grant_type: "password",
      }),
    });
    const tokenData = await tokenRes.json();
    return tokenData?.access_token || null;
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

  async getInvoicePdf(uuid: string): Promise<{ success: true; pdfBuffer: Buffer } | { success: false; error: string }> {
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
      return { success: true, pdfBuffer };
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
}