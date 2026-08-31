/**
 * Firmanın Mysoft API kimliği (kullanıcı adı / şifre / taban URL).
 *
 * ŞUBEDE ANA FİRMADAN DEVRALINIR — VKN'de olduğu gibi (bkz. `effectiveTenantVkn`).
 * Sebep: şube ayrı bir tüzel kişi değil, aynı VKN'nin ikinci adresidir; Mysoft
 * tarafında ayrı bir mükellefi ve ayrı bir şablon kümesi YOKTUR. Şube kurulurken
 * kimlik ana firmadan kopyalanıyor (`lib/company/create-company.ts`), ama yalnız O
 * AN: ana firmaya SONRADAN girilen kullanıcı/şifre şubede boş kalıyor ve şube
 * e-Dönüşüm ekranları (şablonlar, önizleme, kontör) "API bilgileri eksik" diyordu.
 *
 * Devralma tek yönlüdür ve YALNIZ boşluğu doldurur: şubenin kendi kimliği varsa
 * ona dokunulmaz. Böylece bugün çalışan hiçbir şube kimliği değişmez — kural
 * yalnız eksik olanı tamamlar.
 *
 * Bilinen sınır: şube kurulduktan SONRA ana firma şifresini değiştirirse şubede
 * kopyalanmış eski değer durmaya devam eder (kendi kimliği "var" sayılır). Ana
 * firmayı tek doğru kaynak yapmak ayrı bir karar; bugünkü davranışı bozmamak için
 * kasıtlı olarak yapılmadı.
 */

export type EInvoiceCredentialSource = {
  eDonusumApiUsername?: string | null
  eDonusumApiPassword?: string | null
  eDonusumApiUrl?: string | null
}

export type EInvoiceCredentialFields = EInvoiceCredentialSource & {
  parentCompany?: EInvoiceCredentialSource | null
}

/** Prisma select'lerinde tekrar yazmamak için: kimlik + ana firmanın kimliği. */
export const E_INVOICE_CREDENTIAL_SELECT = {
  eDonusumApiUsername: true,
  eDonusumApiPassword: true,
  eDonusumApiUrl: true,
  parentCompany: {
    select: {
      eDonusumApiUsername: true,
      eDonusumApiPassword: true,
      eDonusumApiUrl: true,
    },
  },
} as const

export type EInvoiceCredentials = {
  username: string
  /** ŞİFRELİ değer — çözümü çağıran yapar (`decryptSecret`). */
  password: string
  baseUrl?: string
  /** Kimlik ana firmadan mı geldi? Hata mesajını doğru ekrana yöneltmek için. */
  inherited: boolean
}

/**
 * Kullanılacak kimliği çözer: önce firmanın kendisi, yoksa (şubede) ana firma.
 * İkisi de yoksa `null` — çağıran "bayi" yoluna düşer ya da hata döner.
 */
export function resolveEInvoiceCredentials(
  company: EInvoiceCredentialFields | null | undefined
): EInvoiceCredentials | null {
  if (!company) return null

  if (company.eDonusumApiUsername && company.eDonusumApiPassword) {
    return {
      username: company.eDonusumApiUsername,
      password: company.eDonusumApiPassword,
      baseUrl: company.eDonusumApiUrl || undefined,
      inherited: false,
    }
  }

  const parent = company.parentCompany
  if (parent?.eDonusumApiUsername && parent?.eDonusumApiPassword) {
    return {
      username: parent.eDonusumApiUsername,
      password: parent.eDonusumApiPassword,
      // Taban URL de ana firmadan gelir; şubede boş kalırsa provider varsayılana
      // düşer ve test/canlı ortam sessizce değişebilir.
      baseUrl: parent.eDonusumApiUrl || company.eDonusumApiUrl || undefined,
      inherited: true,
    }
  }

  return null
}

/** Şifre çözülemediğinde gösterilecek mesaj — kimliğin SAHİBİ olan ekrana yöneltir. */
export function credentialDecryptError(inherited: boolean): string {
  return inherited
    ? "Ana firmanın Mysoft şifresi çözülemedi. Ana firmanın E-Dönüşüm Ayarları'ndan şifreyi tekrar girin."
    : "Kayıtlı Mysoft şifresi çözülemedi. E-Dönüşüm Ayarları'ndan şifreyi tekrar girin."
}
