// Firma oluşturmanın TEK yolu. Yeni bir Company satırı YALNIZCA buradan yazılır.
//
// Neden tek yer: "yeni firma" birden fazla kapıdan açılıyor (panel > Firma ve Şube
// Yönetimi, firma seçici, kurulum akışı, sistem yönetimi). Kural her kapıda ayrı
// yazıldığında biri mutlaka eksik kalıyor ve müşteri kotayı bedava aşıyor; hangi kapının
// açık kaldığını da ancak elle test ederek fark ediyoruz. Bu modül kuralı bir kez
// uygular, çağıranlar yalnızca gövdeyi normalize eder.
//
// Sapmayı yakalamak için: `npm run check:company-create` — bu modülün dışında
// `company.create(...)` çağıran kod varsa hata verir.
//
// Üç yerleşim (placement) vardır; ikisi ayrı ürün, ayrı kotadır (bkz. CLAUDE.md →
// "Şube ≠ firma"):
//   branch          → aynı tüzel kişinin ikinci adresi. Kimlik ana firmadan DEVRALINIR.
//                     Subscription.branchQuota'dan düşer.
//   account-company → ayrı VKN'li ek firma. Kendi kimliğini girer; yalnız abonelik ve
//                     modüller hesap kökünden akar. Subscription.companyQuota'dan düşer.
//   new-account     → yeni hesap kökü. Kota aranmaz; bu yüzden KİMİN açabildiği sıkı:
//                     kendi hesabı olmayan kullanıcı (ilk firması) ya da açıkça
//                     `allowAdditionalAccount` veren süper-admin.

import type { Company, Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { defaultDisabledModules } from "@/lib/modules"
import { getFreeModuleKeys } from "@/lib/billing/free-modules"
import { getAccountQuotas, isPaidActive, isTrialActive } from "@/lib/billing/entitlements"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export type CompanyPlacement =
  | { kind: "branch"; parentCompanyId: string }
  | { kind: "account-company"; accountCompanyId: string }
  | { kind: "new-account" }

/** Uçların HTTP durumuna + koduna çevirebildiği bilinen (beklenen) hata. */
export class CompanyCreationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = "CompanyCreationError"
  }
}

/** Şubenin ana firmadan devraldığı kimlik/e-Dönüşüm alanları. */
type InheritedIdentity = Pick<
  Company,
  | "taxNumber"
  | "taxOffice"
  | "isEDonusumEnabled"
  | "eDonusumIntegrator"
  | "eDonusumProvider"
  | "eDonusumApiUsername"
  | "eDonusumApiPassword"
  | "eDonusumAlias"
  | "eDonusumApiUrl"
  | "eDonusumTenantVkn"
  | "eDonusumConnectorGuid"
  | "eDonusumPkAlias"
  | "eDonusumGbAlias"
>

export type ResolvedPlacement = {
  parentCompanyId: string | null
  /** Hesap (faturalama) kökü; yeni hesapta null (firma kendi köküdür). */
  accountRootId: string | null
  /**
   * Yeni firmanın doğacağı modül kümesi: temel (ücretsiz) modüller açık, ücretliler
   * kapalı. Şube ve ek firma da böyle doğar — abonelik firma bazındadır, ana firmadan
   * modül DEVRALINMAZ.
   */
  disabledModules: string[]
  /**
   * Elle kapatılmış TEMEL modüller. Yeni firma bunu DEVRALMAZ (boş doğar): kapatma
   * sistem yöneticisinin o firma için verdiği ayrı bir karardır.
   */
  suppressedModules: string[]
  /** Yalnız şubede dolu: ana firmadan devralınan kimlik alanları. */
  inherited: InheritedIdentity | null
}

/** Formdan gelen, normalize edilmiş firma alanları. */
export type CompanyInput = {
  name: string
  branchName?: string | null
  taxNumber?: string | null
  taxOffice?: string | null
  address?: string | null
  city?: string | null
  phone?: string | null
  email?: string | null
  isEDonusumEnabled?: boolean
  sector?: string | null
  businessModel?: string | null
  employeeRange?: string | null
  monthlyInvoiceVolume?: string | null
  primaryBusinessNeed?: string | null
  usesEDonusumBefore?: boolean | null
  onboardingCompletedAt?: Date | null
}

/**
 * Yerleşimi doğrular: erişim, rol ve KOTA denetimi burada yapılır. Firma yazılmadan
 * önce çağrılır; başarısızsa `CompanyCreationError` fırlatır (fail-closed).
 */
export async function resolveCompanyPlacement(
  placement: CompanyPlacement,
  actorUserId: string,
  opts: { allowAdditionalAccount?: boolean } = {},
): Promise<ResolvedPlacement> {
  if (placement.kind === "branch") {
    const parentId = placement.parentCompanyId
    try {
      await ensureCompanyAccess(parentId)
    } catch {
      throw new CompanyCreationError("Ana firmaya erişiminiz yok", "PARENT_ACCESS_DENIED", 403)
    }

    const parent = await prisma.company.findUnique({ where: { id: parentId } })
    if (!parent) {
      throw new CompanyCreationError("Ana firma bulunamadı", "PARENT_NOT_FOUND", 404)
    }
    // Şube zinciri kurmaya izin verme: bir şubenin altına şube eklenemez.
    if (parent.parentCompanyId) {
      throw new CompanyCreationError(
        "Bir şubenin altına şube eklenemez. Lütfen ana firmayı seçin.",
        "NESTED_BRANCH",
        400,
      )
    }

    // Şubenin hesabı ana firmanın hesabıdır; ek firmanın şubesi de doğrudan kökü
    // gösterir, zincir kurulmaz (bkz. prisma → Company.accountRootId).
    const accountRootId = parent.accountRootId ?? parent.id

    // Kota: hesabın aktif aboneliğindeki branchQuota kadar şube açılabilir. Aktif
    // abonelik yoksa kota 0'dır. Aynı fonksiyon "kaç şube daha açabilirim"
    // göstergesini de besler ([[lib/billing/entitlements.ts]]) — ekranla API ayrışmaz.
    const { branch } = await getAccountQuotas(accountRootId)
    if (!branch.canAdd) {
      throw new CompanyCreationError(
        "Şube kotanız dolu. Yeni şube eklemek için ek şube satın alın.",
        "BRANCH_QUOTA_EXCEEDED",
        402,
        { quota: branch.quota, used: branch.used },
      )
    }

    // MODÜL DEVRİ YOK: şube ana firmanın aboneliğinden yararlanmaz, kendi aboneliğini
    // satın alır (2026-09-04 kararı). Kimlik alanları devralınmaya devam eder —
    // şube aynı tüzel kişidir, VKN/vergi dairesi/e-Dönüşüm ana firmadan gelir.
    // Elle kapatma da devralınmaz: yeni firma temiz doğar, kapatma firmanın kendi
    // kararıdır (sistem-admin kartından verilir).
    return {
      parentCompanyId: parentId,
      accountRootId,
      disabledModules: defaultDisabledModules(await getFreeModuleKeys()),
      suppressedModules: [],
      inherited: parent,
    }
  }

  if (placement.kind === "account-company") {
    const accountId = placement.accountCompanyId
    let access
    try {
      access = await ensureCompanyAccess(accountId)
    } catch {
      throw new CompanyCreationError("Hesaba erişiminiz yok", "ACCOUNT_ACCESS_DENIED", 403)
    }
    // Kota harcamak abonelik tasarrufudur: yalnız hesabın yöneticisi yapabilir.
    if (access.role !== "ADMIN") {
      throw new CompanyCreationError(
        "Yeni firma eklemek yalnızca firma yöneticisine açıktır",
        "ADMIN_REQUIRED",
        403,
      )
    }

    const { rootCompanyId, company } = await getAccountQuotas(accountId)
    if (!company.canAdd) {
      throw new CompanyCreationError(
        "Firma kotanız dolu. Yeni firma eklemek için ek firma satın alın.",
        "COMPANY_QUOTA_EXCEEDED",
        402,
        { quota: company.quota, used: company.used },
      )
    }

    // MODÜL DEVRİ YOK: ek firma ayrı bir tüzel kişidir ve kendi aboneliğini satın alır.
    // Hesaptan devraldığı tek şey KOTA hakkıdır (bu firmayı açabilmiş olması).
    // Temel (ücretsiz) modüller açık, ücretliler kilitli doğar.
    return {
      parentCompanyId: null,
      accountRootId: rootCompanyId,
      disabledModules: defaultDisabledModules(await getFreeModuleKeys()),
      suppressedModules: [],
      inherited: null,
    }
  }

  // new-account: kota aranmadığı için KAPININ kendisi dar tutulur.
  if (!opts.allowAdditionalAccount) {
    // Kendi hesabı olan kullanıcı buraya düşemez; ikinci firmasını ek firma olarak
    // (hesaba bağlı, kotadan) açar. Aksi halde kota bedava atlanırdı.
    //
    // Ölçü "kaç firmaya üyeyim" DEĞİL "kendi hesabım var mı": başkasının firmasında
    // çalışan biri (hatta ADMIN'i olan bir mali müşavir) kendi ilk firmasını açabilmeli.
    const ownedRoots = await prisma.userCompany.count({
      where: {
        userId: actorUserId,
        role: "ADMIN",
        company: { parentCompanyId: null, accountRootId: null },
      },
    })
    if (ownedRoots > 0) {
      throw new CompanyCreationError(
        "Zaten bir hesabınız var. Yeni firmayı mevcut hesabınıza ek firma olarak ekleyin.",
        "ACCOUNT_REQUIRED",
        400,
      )
    }
  }

  // Yeni hesap yalnız TEMEL (ücretsiz) modüller açık doğar; ücretlisi satın almayla
  // açılır ([[lib/billing/entitlements.ts]] → applyEntitlements). Ücretsiz küme boşsa
  // sonuç eski davranışın aynısı: tam kilit.
  return {
    parentCompanyId: null,
    accountRootId: null,
    disabledModules: defaultDisabledModules(await getFreeModuleKeys()),
    suppressedModules: [],
    inherited: null,
  }
}

/**
 * Kotayı YAZMA anında, kilit altında son kez doğrular (yarış koşulu kapısı).
 *
 * `resolveCompanyPlacement` kontrolü ile INSERT arasında bir pencere var: aynı anda gelen
 * iki istek ikisi de "yer var" görüp kotanın bir fazlasını açabilirdi (çift tıklama,
 * paralel sekme). Hesabın abonelik satırı `FOR UPDATE` ile kilitlenir; ikinci istek
 * birincinin COMMIT'ini bekler ve sayımı onun firmasını DA görerek tekrarlar
 * (PostgreSQL READ COMMITTED: kilit serbest kalınca ifade güncel veriyle yeniden okunur).
 */
async function assertQuotaUnderLock(
  tx: Prisma.TransactionClient,
  rootCompanyId: string,
  kind: "branch" | "account-company",
): Promise<void> {
  const locked = await tx.$queryRaw<
    Array<{
      status: string
      purchasedModules: string[]
      branchQuota: number
      companyQuota: number
      periodEnd: Date | null
      trialEndsAt: Date | null
    }>
  >`
    SELECT s."status", s."purchasedModules", s."branchQuota", s."companyQuota",
           s."periodEnd", s."trialEndsAt"
      FROM public.subscriptions s
     WHERE s."companyId" = ${rootCompanyId}
     ORDER BY s."createdAt" DESC
     LIMIT 1
     FOR UPDATE
  `
  const sub = locked[0] ?? null
  // Aktiflik ölçüsü `getAccountQuotas` ile AYNI olmalı; ayrışırsa kapı ile gösterge
  // farklı cevap verir. Abonelik yoksa/aktif değilse kota tanım gereği 0'dır.
  const active = !!sub && (isPaidActive(sub) || isTrialActive(sub))

  const isBranch = kind === "branch"
  const quota = active ? (isBranch ? sub!.branchQuota : sub!.companyQuota) : 0
  const used = await tx.company.count({
    where: isBranch
      ? { accountRootId: rootCompanyId, parentCompanyId: { not: null } }
      : { accountRootId: rootCompanyId, parentCompanyId: null },
  })

  if (used >= quota) {
    throw new CompanyCreationError(
      isBranch
        ? "Şube kotanız dolu. Yeni şube eklemek için ek şube satın alın."
        : "Firma kotanız dolu. Yeni firma eklemek için ek firma satın alın.",
      isBranch ? "BRANCH_QUOTA_EXCEEDED" : "COMPANY_QUOTA_EXCEEDED",
      402,
      { quota, used },
    )
  }
}

/**
 * Firmayı oluşturur: kayıt + (istenirse) ADMIN üyeliği + varsayılan "Ana Depo".
 * Üçü tek transaction'da yazılır — deposuz ya da sahipsiz yarım firma kalmaz.
 *
 * Kota/erişim denetimi `resolveCompanyPlacement` içindedir ve burada MUTLAKA çağrılır;
 * çağıranın ayrıca denetim yapmasına gerek yoktur (ve yapmamalıdır — kural tek yerde).
 */
export async function createCompany(args: {
  actorUserId: string
  placement: CompanyPlacement
  input: CompanyInput
  /** Oluşturana ADMIN üyeliği verilsin mi? Süper-admin müşteri kabuğu açarken false. */
  grantMembership: boolean
  /**
   * `new-account` yerleşiminde "zaten hesabın var" kuralını atlar. YALNIZCA süper-admin
   * ucu içindir (müşteri adına yeni hesap açar) ve her kullanımı bilinçli olmalıdır.
   */
  allowAdditionalAccount?: boolean
}): Promise<Company> {
  const { actorUserId, placement, input, grantMembership } = args

  const name = input.name.trim()
  if (!name) {
    throw new CompanyCreationError("Firma adı zorunludur", "NAME_REQUIRED", 400)
  }
  // Şubede ünvan ana firmadan devralınır; şube ismi olmazsa şube, listelerde ve
  // seçicide ana firmayla birebir aynı görünür (ayırt edilemez). Bu yüzden zorunlu.
  const branchName = input.branchName?.trim() || null
  if (placement.kind === "branch" && !branchName) {
    throw new CompanyCreationError("Şube ismi zorunludur", "BRANCH_NAME_REQUIRED", 400)
  }

  const resolved = await resolveCompanyPlacement(placement, actorUserId, {
    allowAdditionalAccount: args.allowAdditionalAccount,
  })
  const { inherited } = resolved

  return prisma.$transaction(async (tx) => {
    // Kotalı yerleşimlerde son söz burada, kilit altında verilir (yarış kapısı).
    // `new-account` kotasız olduğu için atlanır.
    if (placement.kind !== "new-account" && resolved.accountRootId) {
      await assertQuotaUnderLock(tx, resolved.accountRootId, placement.kind)
    }

    const company = await tx.company.create({
      data: {
        name,
        branchName,
        address: input.address ?? null,
        city: input.city ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        parentCompanyId: resolved.parentCompanyId,
        accountRootId: resolved.accountRootId,
        disabledModules: resolved.disabledModules,
        suppressedModules: resolved.suppressedModules,
        // Kimlik: şubede ana firmadan devralınır, diğer modlarda formdan (ek firma da
        // kendi VKN'sini girer — ayrı tüzel kişidir).
        taxNumber: inherited ? inherited.taxNumber : input.taxNumber ?? null,
        taxOffice: inherited ? inherited.taxOffice : input.taxOffice ?? null,
        isEDonusumEnabled: inherited
          ? inherited.isEDonusumEnabled
          : Boolean(input.isEDonusumEnabled),
        ...(inherited
          ? {
              eDonusumIntegrator: inherited.eDonusumIntegrator,
              eDonusumProvider: inherited.eDonusumProvider,
              eDonusumApiUsername: inherited.eDonusumApiUsername,
              eDonusumApiPassword: inherited.eDonusumApiPassword,
              eDonusumAlias: inherited.eDonusumAlias,
              eDonusumApiUrl: inherited.eDonusumApiUrl,
              eDonusumTenantVkn: inherited.eDonusumTenantVkn,
              eDonusumConnectorGuid: inherited.eDonusumConnectorGuid,
              eDonusumPkAlias: inherited.eDonusumPkAlias,
              eDonusumGbAlias: inherited.eDonusumGbAlias,
              // Şube oluşturulurken profil/onboarding sihirbazı çalışmaz.
              onboardingCompletedAt: new Date(),
            }
          : {
              sector: input.sector ?? null,
              businessModel: input.businessModel ?? null,
              employeeRange: input.employeeRange ?? null,
              monthlyInvoiceVolume: input.monthlyInvoiceVolume ?? null,
              primaryBusinessNeed: input.primaryBusinessNeed ?? null,
              usesEDonusumBefore:
                typeof input.usesEDonusumBefore === "boolean" ? input.usesEDonusumBefore : null,
              onboardingCompletedAt: input.onboardingCompletedAt ?? null,
            }),
      },
    })

    if (grantMembership) {
      await tx.userCompany.create({
        data: { userId: actorUserId, companyId: company.id, role: "ADMIN" },
      })
    }

    // Stok hareketi bir depo ister; varsayılansız firma ilk stok işleminde patlar.
    await tx.warehouse.create({
      data: { companyId: company.id, code: "ANA", name: "Ana Depo", isDefault: true },
    })

    return company
  })
}
