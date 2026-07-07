import { MysoftEInvoiceProvider } from "./mysoft-provider"
import { createPartnerProvider, PARTNER_NOT_CONFIGURED_ERROR } from "./partner"
import { effectiveTenantVkn } from "./tenant"
import { decryptSecret } from "@/lib/crypto/secrets"

/**
 * Bir firmanın e-Belge işlemleri (fatura gönder/durum/iptal/pdf, gelen fatura) için
 * kullanılacak Mysoft provider'ını çözer. İKİ yol vardır:
 *
 *  1) MANUEL (gelişmiş) — Firmanın kendi Mysoft API kullanıcı adı/şifresi kayıtlıysa
 *     DAİMA o kullanılır. Bu, projedeki mevcut (çalışan) davranıştır; birebir korunur.
 *
 *  2) BAYİ (self-servis onboarding) — Firmanın kendi kimliği YOK ama Kobipo bayi hesabı
 *     altında bir tenant'ı açıldıysa (eDonusumTenantVkn / onboarding durumu), master bayi
 *     kimliği kullanılır ve işlem firmanın VKN'si `tenantIdentifierNumber` ile o firma
 *     adına yapılır. Firmanın ayrı bir Mysoft kullanıcısı/şifresi olmaz.
 *
 * Plan: docs/e-donusum-onboarding/PLAN.md (Faz 4)
 */

export type CompanyProviderFields = {
  isEDonusumEnabled?: boolean | null
  eDonusumApiUsername?: string | null
  eDonusumApiPassword?: string | null
  eDonusumApiUrl?: string | null
  taxNumber?: string | null
  eDonusumTenantVkn?: string | null
  eDonusumOnboardingStatus?: string | null
  parentCompany?: { taxNumber?: string | null } | null
}

/** Provider select'lerinde tekrar tekrar yazmamak için ortak alan kümesi. */
export const COMPANY_PROVIDER_SELECT = {
  isEDonusumEnabled: true,
  eDonusumApiUsername: true,
  eDonusumApiPassword: true,
  eDonusumApiUrl: true,
  taxNumber: true,
  eDonusumTenantVkn: true,
  eDonusumOnboardingStatus: true,
  parentCompany: { select: { taxNumber: true } },
} as const

export type ResolvedCompanyProvider =
  | { ok: true; provider: MysoftEInvoiceProvider; tenantVkn: string; mode: "manual" | "bayi" }
  | { ok: false; status: number; error: string }

/** Firma bayi altında açılmış (self-servis onboarding görmüş) bir tenant'a sahip mi? */
function isOnboardedViaBayi(company: CompanyProviderFields): boolean {
  return (
    Boolean(company.eDonusumTenantVkn) ||
    ["TENANT_CREATED", "ACTIVATION_PENDING", "ACTIVE"].includes(
      company.eDonusumOnboardingStatus || "",
    )
  )
}

export function resolveCompanyEInvoiceProvider(
  company: CompanyProviderFields | null | undefined,
): ResolvedCompanyProvider {
  if (!company) return { ok: false, status: 404, error: "Firma bulunamadı" }

  const tenantVkn = effectiveTenantVkn(company)

  // 1) MANUEL yol — firmanın kendi kimliği varsa her zaman öncelikli (mevcut davranış).
  if (company.eDonusumApiUsername && company.eDonusumApiPassword) {
    let passwordText: string
    try {
      passwordText = decryptSecret(company.eDonusumApiPassword)
    } catch {
      return {
        ok: false,
        status: 400,
        error: "Kayıtlı Mysoft şifresi çözülemedi. E-Dönüşüm Ayarları'ndan şifreyi tekrar girin.",
      }
    }
    const provider = new MysoftEInvoiceProvider({
      username: company.eDonusumApiUsername,
      passwordText,
      baseUrl: company.eDonusumApiUrl || undefined,
      vknTckn: tenantVkn || undefined,
    })
    return { ok: true, provider, tenantVkn, mode: "manual" }
  }

  // 2) BAYİ yol — kendi kimliği yok ama bayi altında tenant'ı var → master bayi + firma VKN.
  if (isOnboardedViaBayi(company)) {
    if (!tenantVkn) {
      return {
        ok: false,
        status: 400,
        error: "Firma VKN/TCKN geçersiz — bayi kimliğiyle işlem için firmanın VKN'si gerekli.",
      }
    }
    const provider = createPartnerProvider(tenantVkn)
    if (!provider) {
      return { ok: false, status: 400, error: PARTNER_NOT_CONFIGURED_ERROR }
    }
    return { ok: true, provider, tenantVkn, mode: "bayi" }
  }

  // 3) Hiçbir bağlantı yok.
  return {
    ok: false,
    status: 400,
    error:
      "Firmanın Mysoft e-Dönüşüm bağlantısı yok. E-Dönüşüm Ayarları'ndan başvuru yapın (self-servis) veya mevcut Mysoft API kimliğinizi girin.",
  }
}
