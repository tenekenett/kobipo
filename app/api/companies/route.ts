import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { getUserContext } from "@/lib/auth/user-context"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import {
  getAccountSubscription,
  countAccountBranches,
  isPaidActive,
  isTrialActive,
} from "@/lib/billing/entitlements"
import { MODULE_KEYS } from "@/lib/modules"
import { Prisma } from "@prisma/client"

export const dynamic = 'force-dynamic'

const normalizeOptionalString = (value: unknown) => {
  if (typeof value !== "string") return null
  const trimmedValue = value.trim()
  return trimmedValue.length > 0 ? trimmedValue : null
}

const isMissingSchemaError = (error: Prisma.PrismaClientKnownRequestError) => {
  return error.code === "P2021" || error.code === "P2022"
}


export async function GET() {
  try {
    const context = await getUserContext()
    if (!context) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Pasif firmalar normal kullanıcının erişilebilir listesinde görünmez; super admin
    // hepsini görür. Alt şubeler (isBranch) context'te zaten gelir ve flag'li döner —
    // tüketiciler (ör. üst firma seçici, ana firma seçimi) gerektiğinde filtreler.
    const companies = context.companies
      .filter((c) => context.isSuperAdmin || c.isActive)
      .map((c) => ({
        id: c.companyId,
        slug: c.companySlug,
        name: c.companyName,
        // Ünvandan ayrı kısa şube ismi; seçicide "Ünvan (Şube)" olarak gösterilir.
        branchName: c.companyBranchName ?? null,
        // Rol firma bazında değişir; istemci aktif rolü seçili firmadan türetir.
        role: c.role,
        isEDonusumEnabled: c.isEDonusumEnabled,
        disabledModules: c.disabledModules,
        isBranch: Boolean(c.isBranch),
        parentCompanyId: c.parentCompanyId ?? null,
        parentName: c.parentName ?? null,
      }))

    return NextResponse.json(companies)
  } catch (error) {
    console.error("Error fetching companies:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const {
      name,
      branchName,
      taxNumber,
      taxOffice,
      address,
      city,
      phone,
      email,
      isEDonusumEnabled,
      sector,
      businessModel,
      employeeRange,
      monthlyInvoiceVolume,
      primaryBusinessNeed,
      usesEDonusumBefore,
      onboardingCompletedAt,
      parentCompanyId,
    } = body

    // Şube modu: parentCompanyId verilirse, oluşturulan kayıt ana firmaya bağlı bir
    // şubedir. VKN/vergi dairesi/e-Dönüşüm kimliği ana firmadan DEVRALINIR (aynı tüzel
    // kişi) — istemciden gelen taxNumber/taxOffice/e-Dönüşüm alanları yok sayılır.
    //
    // SEF sonrası dashboard URL'leri `?company=<slug>` taşır ve "Yeni Şube" bağlantısı bu
    // değeri `parent=` olarak aktarır → buraya cuid yerine SLUG gelebilir. resolveCompanyId
    // ile cuid'e çevrilmezse ensureCompanyAccess eşleşme bulamaz ve kullanıcı kendi ana
    // firmasındayken "Ana firmaya erişiminiz yok" hatası alır.
    const normalizedParentId = await resolveCompanyId(normalizeOptionalString(parentCompanyId))

    const trimmedName = String(name || "").trim()
    const normalizedBranchName = normalizeOptionalString(branchName)
    const normalizedTaxNumber = normalizeOptionalString(taxNumber)
    const normalizedTaxOffice = normalizeOptionalString(taxOffice)
    const normalizedAddress = normalizeOptionalString(address)
    const normalizedCity = normalizeOptionalString(city)
    const normalizedPhone = normalizeOptionalString(phone)
    const normalizedEmail = normalizeOptionalString(email)
    const normalizedSector = normalizeOptionalString(sector)
    const normalizedBusinessModel = normalizeOptionalString(businessModel)
    const normalizedEmployeeRange = normalizeOptionalString(employeeRange)
    const normalizedMonthlyInvoiceVolume = normalizeOptionalString(monthlyInvoiceVolume)
    const normalizedPrimaryBusinessNeed = normalizeOptionalString(primaryBusinessNeed)

    if (!trimmedName) {
      return NextResponse.json(
        { error: "Firma adı zorunludur" },
        { status: 400 }
      )
    }

    // Şubede ünvan ana firmadan devralınır; şube ismi olmazsa şube, listelerde ve
    // seçicide ana firmayla birebir aynı görünür (ayırt edilemez). Bu yüzden zorunlu.
    if (normalizedParentId && !normalizedBranchName) {
      return NextResponse.json(
        { error: "Şube ismi zorunludur", code: "BRANCH_NAME_REQUIRED" },
        { status: 400 }
      )
    }

    // Şube ise ana firmanın kimlik/e-Dönüşüm bilgilerini yükle ve devral.
    type CompanyRow = NonNullable<Awaited<ReturnType<typeof prisma.company.findUnique>>>
    type InheritedFields = Pick<
      CompanyRow,
      | "taxNumber"
      | "taxOffice"
      | "disabledModules"
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
    let inherited: InheritedFields | null = null
    if (normalizedParentId) {
      let parentCompany: CompanyRow | null = null
      try {
        await ensureCompanyAccess(normalizedParentId)
      } catch {
        return NextResponse.json(
          { error: "Ana firmaya erişiminiz yok", code: "PARENT_ACCESS_DENIED" },
          { status: 403 }
        )
      }
      parentCompany = await prisma.company.findUnique({ where: { id: normalizedParentId } })
      if (!parentCompany) {
        return NextResponse.json(
          { error: "Ana firma bulunamadı", code: "PARENT_NOT_FOUND" },
          { status: 404 }
        )
      }
      // Şube zinciri kurmaya izin verme: bir şubenin altına şube eklenemez.
      if (parentCompany.parentCompanyId) {
        return NextResponse.json(
          { error: "Bir şubenin altına şube eklenemez. Lütfen ana firmayı seçin.", code: "NESTED_BRANCH" },
          { status: 400 }
        )
      }
      inherited = parentCompany

      // Şube kotası enforcement (Aşama 5): hesabın (kök firma = ana firma, şube zinciri yasak)
      // aktif aboneliğindeki `branchQuota` kadar ek şube açılabilir. Aktif abonelik yoksa
      // (deneme/ücretli değil) kota 0'dır → şube açılamaz (fail closed). Modül gating
      // callback'te disabledModules ile yazılır; burada yalnızca ADET sınırı uygulanır.
      const accountSub = await getAccountSubscription(normalizedParentId)
      const branchesAllowed =
        accountSub && (isPaidActive(accountSub) || isTrialActive(accountSub))
          ? accountSub.branchQuota
          : 0
      const existingBranches = await countAccountBranches(normalizedParentId)
      if (existingBranches >= branchesAllowed) {
        return NextResponse.json(
          {
            error: "Şube kotanız dolu. Yeni şube eklemek için aboneliğinizi yükseltin.",
            code: "PLAN_LIMIT_EXCEEDED",
            branchQuota: branchesAllowed,
            currentBranches: existingBranches,
          },
          { status: 402 }
        )
      }
    }

    let parsedOnboardingCompletedAt: Date | null = null
    if (onboardingCompletedAt != null) {
      if (typeof onboardingCompletedAt !== "string") {
        return NextResponse.json(
          { error: "Geçersiz onboarding tarihi" },
          { status: 400 }
        )
      }

      parsedOnboardingCompletedAt = new Date(onboardingCompletedAt)
      if (Number.isNaN(parsedOnboardingCompletedAt.getTime())) {
        return NextResponse.json(
          { error: "Geçersiz onboarding tarihi" },
          { status: 400 }
        )
      }
    }

    const userCompanyCount = await prisma.userCompany.count({
      where: { userId: user.id },
    })

    let currentMaxCompanies = 1
    try {
      const currentSubscription = await prisma.subscription.findFirst({
        where: {
          userId: user.id,
          status: { in: ["TRIAL", "ACTIVE"] },
        },
        include: { plan: true },
        orderBy: { createdAt: "desc" },
      })
      currentMaxCompanies = currentSubscription?.plan?.maxCompanies ?? 1
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        isMissingSchemaError(error) &&
        userCompanyCount === 0
      ) {
        console.warn("Subscription schema missing, allowing first company creation", {
          userId: user.id,
          code: error.code,
        })
      } else {
        throw error
      }
    }

    // Şube oluşturma (parentCompanyId set) yukarıda branchQuota ile sınırlanır; bu
    // per-kullanıcı maxCompanies limiti YALNIZCA yeni bağımsız firma açarken uygulanır.
    if (!normalizedParentId && userCompanyCount >= currentMaxCompanies) {
      return NextResponse.json(
        {
          error: "Yeni sube eklemek icin abonelik yukseltilmelidir",
          code: "PLAN_LIMIT_EXCEEDED",
          maxCompanies: currentMaxCompanies,
        },
        { status: 402 }
      )
    }

    const company = await prisma.$transaction(async (tx) => {
      const createdCompany = await tx.company.create({
        data: {
          name: trimmedName,
          branchName: normalizedBranchName,
          address: normalizedAddress,
          city: normalizedCity,
          phone: normalizedPhone,
          email: normalizedEmail,
          // Adres dışı kimlik bilgileri: şubede ana firmadan devralınır, aksi halde formdan.
          parentCompanyId: inherited ? normalizedParentId : null,
          taxNumber: inherited ? inherited.taxNumber : normalizedTaxNumber,
          taxOffice: inherited ? inherited.taxOffice : normalizedTaxOffice,
          // Modül yetkisi YALNIZCA satın almayla açılır: yeni hesap tüm modüller kapalı
          // doğar, ödeme callback'i `applyEntitlements` ile açar. Şube kendi yetkisini
          // taşımaz — abonelik hesap düzeyindedir, o yüzden ana firmanınkini devralır
          // (aksi halde kilitli bir hesabın şubesi boş listeyle tamamen açık doğardı).
          disabledModules: inherited ? inherited.disabledModules : [...MODULE_KEYS],
          isEDonusumEnabled: inherited ? inherited.isEDonusumEnabled : Boolean(isEDonusumEnabled),
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
                sector: normalizedSector,
                businessModel: normalizedBusinessModel,
                employeeRange: normalizedEmployeeRange,
                monthlyInvoiceVolume: normalizedMonthlyInvoiceVolume,
                primaryBusinessNeed: normalizedPrimaryBusinessNeed,
                usesEDonusumBefore:
                  typeof usesEDonusumBefore === "boolean" ? usesEDonusumBefore : null,
                onboardingCompletedAt: parsedOnboardingCompletedAt,
              }),
        },
      })

      await tx.userCompany.create({
        data: {
          userId: user.id,
          companyId: createdCompany.id,
          role: "ADMIN",
        },
      })

      await tx.warehouse.create({
        data: {
          companyId: createdCompany.id,
          code: "ANA",
          name: "Ana Depo",
          isDefault: true,
        },
      })

      // İlk firmaya 1 yıllık FREE_1Y denemesi AÇILMAZ. Modül yetkisi yalnızca satın
      // almayla gelir; abonelik satırı ilk ödemede (PayTR callback) oluşur. Abonelik
      // yokken `currentMaxCompanies` zaten 1 — ikinci bağımsız firma limiti değişmedi.

      return createdCompany
    })

    return NextResponse.json(company, { status: 201 })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return NextResponse.json(
          { error: "Vergi numarası zaten kullanımda", code: "COMPANY_TAX_NUMBER_CONFLICT" },
          { status: 409 }
        )
      }

      if (isMissingSchemaError(error)) {
        console.error("Schema mismatch during company creation", {
          code: error.code,
          meta: error.meta,
        })
        return NextResponse.json(
          { error: "Veritabanı şeması güncel değil", code: "DB_SCHEMA_MISMATCH" },
          { status: 500 }
        )
      }
    }

    console.error("Error creating company:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

