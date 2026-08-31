import { MysoftEInvoiceProvider } from "./mysoft-provider"
import { createPartnerProvider, PARTNER_NOT_CONFIGURED_ERROR } from "./partner"
import { effectiveTenantVkn } from "./tenant"
import {
  credentialDecryptError,
  resolveEInvoiceCredentials,
  type EInvoiceCredentialFields,
  type EInvoiceCredentialSource,
} from "./credentials"
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

export type CompanyProviderFields = EInvoiceCredentialFields & {
  isEDonusumEnabled?: boolean | null
  taxNumber?: string | null
  eDonusumTenantVkn?: string | null
  eDonusumOnboardingStatus?: string | null
  parentCompany?: (EInvoiceCredentialSource & { taxNumber?: string | null }) | null
}

/**
 * Provider select'lerinde tekrar tekrar yazmamak için ortak alan kümesi.
 *
 * Ana firmadan hem VKN hem KİMLİK okunur: şube ikisini de devralır (bkz.
 * `resolveEInvoiceCredentials`). Alt select'i bölerseniz şube, ana firmaya
 * sonradan girilen kullanıcı/şifreyi göremez.
 */
export const COMPANY_PROVIDER_SELECT = {
  isEDonusumEnabled: true,
  eDonusumApiUsername: true,
  eDonusumApiPassword: true,
  eDonusumApiUrl: true,
  taxNumber: true,
  eDonusumTenantVkn: true,
  eDonusumOnboardingStatus: true,
  parentCompany: {
    select: {
      taxNumber: true,
      eDonusumApiUsername: true,
      eDonusumApiPassword: true,
      eDonusumApiUrl: true,
    },
  },
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

  // 1) MANUEL yol — kendi kimliği (yoksa ŞUBEDE ana firmanınki) varsa her zaman
  //    öncelikli. Devralma yalnız boşluğu doldurur; mevcut davranış korunur.
  const creds = resolveEInvoiceCredentials(company)
  if (creds) {
    let passwordText: string
    try {
      passwordText = decryptSecret(creds.password)
    } catch {
      return { ok: false, status: 400, error: credentialDecryptError(creds.inherited) }
    }
    const provider = new MysoftEInvoiceProvider({
      username: creds.username,
      passwordText,
      baseUrl: creds.baseUrl,
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
