import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { MysoftEInvoiceProvider } from "@/lib/integrations/e-invoice/mysoft-provider"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { decryptSecret } from "@/lib/crypto/secrets"

export const dynamic = "force-dynamic"

/**
 * Mysoft'a /api/InvoiceOutbox/createInvoiceOutboxTestJson çağrısı atıp
 * hesaba özel örnek payload'ı döndürür. Bu yanıt, sizin hesabınız için Mysoft'un
 * kabul edeceği prefix/connectorGuid/pkAlias/gbAlias gibi değerleri içerir.
 *
 * Çağıran bunu görüp gerçek değerleri Şirket profilinde saklayabilir.
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { companyId } = body || {}
    if (!companyId) {
      return NextResponse.json({ success: false, error: "companyId zorunlu" }, { status: 400 })
    }

    await ensureCompanyAccess(companyId)
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
        { success: false, error: "Önce API kullanıcı adı ve şifreyi kaydedin (E-Dönüşüm Ayarları)." },
        { status: 400 }
      )
    }

    let passwordText: string
    try {
      passwordText = decryptSecret(company.eDonusumApiPassword)
    } catch {
      return NextResponse.json(
        { success: false, error: "Kayıtlı şifre çözülemedi. Şifreyi tekrar girip kaydedin." },
        { status: 400 }
      )
    }

    const provider = new MysoftEInvoiceProvider({
      username: company.eDonusumApiUsername,
      passwordText,
      baseUrl: company.eDonusumApiUrl || undefined,
    })

    const sample = await provider.getSampleInvoicePayload()
    if (!sample.success) {
      return NextResponse.json(
        {
          success: false,
          error: sample.error || "Örnek payload alınamadı.",
          rawResponse: sample.rawResponse,
        },
        { status: 200 }
      )
    }

    // Mysoft yanıtı genelde { succeed, message, data: {...} } şeklinde.
    // Hem direkt root hem data altını kontrol et.
    const payload =
      sample.rawResponse?.data && typeof sample.rawResponse.data === "object"
        ? sample.rawResponse.data
        : sample.rawResponse

    const extracted: Record<string, unknown> = {}
    const pick = (key: string) => {
      const v = payload?.[key]
      if (v !== undefined && v !== null) extracted[key] = v
    }
    pick("connectorGuid")
    pick("prefix")
    pick("pkAlias")
    pick("gbAlias")
    pick("eDocumentType")
    pick("profile")
    pick("invoiceType")
    pick("senderType")
    pick("currencyCode")

    // ÖNEMLİ: createInvoiceOutboxTestJson endpoint'i her çağrıda RANDOM connectorGuid
    // üretiyor (test sample, gerçek değer değil). Bu yüzden connectorGuid'i KAYDETMİYORUZ
    // ve daha önce kaydedilmiş bozuk değeri null'a çekiyoruz. Mysoft token'dan kendi
    // bilir; payload'da bu alanı boş bırakmak daha güvenli.
    // pkAlias/gbAlias de "urn:mail:defaultpk@mysoft.com.tr" gibi generic test default'ları
    // dönüyor — onları da artık kaydetmiyoruz; varsa da null'a çekiyoruz.
    const updates: Record<string, string | null> = {
      eDonusumConnectorGuid: null,
      eDonusumPkAlias: null,
      eDonusumGbAlias: null,
    }
    let persistError: string | null = null
    if (Object.keys(updates).length > 0) {
      try {
        await prisma.company.update({ where: { id: companyId }, data: updates as any })
      } catch (e: any) {
        persistError =
          (e?.message || "Veritabanı güncellemesi başarısız") +
          " — Büyük ihtimalle yeni kolonlar (eDonusumConnectorGuid/eDonusumPkAlias/eDonusumGbAlias) DB'de yok. Dev server kapalıyken `npm run db:push` çalıştırın."
        console.error("discover-mysoft-config: persist failed", e)
      }
    }

    return NextResponse.json({
      success: true,
      extracted,
      saved: persistError ? [] : Object.keys(updates),
      persistError,
      rawResponse: sample.rawResponse,
      hint: persistError
        ? "UYARI: keşif çalıştı ama DB'ye kaydedemedi. Migration'ı çalıştırın."
        : "DİKKAT: Mysoft örnek payload'da connectorGuid + pkAlias/gbAlias değerleri her çağrıda RANDOM/generic dönüyor (gerçek değil). Sadece prefix alanı stabil — onu E-Fatura/E-Arşiv inputlarına kopyalayın.",
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 })
    }
    console.error("discover-mysoft-config error:", error)
    return NextResponse.json(
      { success: false, error: message || "Keşif sırasında hata oluştu." },
      { status: 500 }
    )
  }
}
