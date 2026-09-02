import { fisTaramaAcikMi } from "@/lib/fis-ocr/access"
import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { getUserContext } from "@/lib/auth/user-context"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import {
  CompanyCreationError,
  createCompany,
  type CompanyPlacement,
} from "@/lib/company/create-company"
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
        // İstemci listesi ile layout yükü aynı alanları taşımalı.
        isFisTaramaEnabled: fisTaramaAcikMi({ id: c.companyId, slug: c.companySlug }),
        disabledModules: c.disabledModules,
        // Hesap salt-okunur arşivde mi? Düşerse arayüz düzenleme düğmelerini çizer,
        // kullanıcı tıklar ve 403 yer — kapı tutar ama ekran yalan söyler.
        isArchived: c.isArchived,
        // Kısıtlı çalışan izinleri de firma bazında; menü bunlara göre daraltılır.
        // Boş dizi = kısıt yok. Listeden DÜŞÜRÜLEMEZ: istemci bu alanı görmezse
        // kısıtlı kullanıcıya tam menü çizilir (kapı yine tutar ama ekran yanıltır).
        allowedPaths: c.allowedPaths,
        writablePaths: c.writablePaths,
        // Özel rol bilgisi menüyü çizen tarafa da geçmeli: yetki tavanı buna göre
        // değişiyor ve düşürülürse istemci kullanıcıyı yetkisiz sanır.
        customRoleId: c.customRoleId,
        customRoleName: c.customRoleName,
        isBranch: Boolean(c.isBranch),
        parentCompanyId: c.parentCompanyId ?? null,
        parentName: c.parentName ?? null,
        // Şube DEĞİL ama dolu ise: hesaba bağlı ek firma (ayrı VKN, ortak abonelik).
        // Arayüz rozeti bu ikiliden çizer; düşerse ek firma sıradan bir firma görünür.
        accountRootId: c.accountRootId ?? null,
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
      accountCompanyId,
    } = body

    // Yerleşimi (şube / ek firma / yeni hesap) gövde belirler; ERİŞİM, ROL ve KOTA
    // denetimi bu uçta DEĞİL, tek ortak yerde yapılır: [[lib/company/create-company.ts]].
    // Bu uç yalnızca gövdeyi normalize eder — kuralın kopyası burada tutulmaz, yoksa
    // firma oluşturan ikinci bir kapı açıldığında kural onunla birlikte çoğalır.
    //
    // SEF sonrası dashboard URL'leri `?company=<slug>` taşır ve bağlantılar bu değeri
    // `parent=`/`account=` olarak aktarır → buraya cuid yerine SLUG gelebilir.
    // resolveCompanyId ile cuid'e çevrilmezse erişim kontrolü eşleşme bulamaz ve
    // kullanıcı kendi firmasındayken "erişiminiz yok" hatası alır.
    const normalizedParentId = await resolveCompanyId(normalizeOptionalString(parentCompanyId))
    const normalizedAccountId = await resolveCompanyId(normalizeOptionalString(accountCompanyId))

    const placement: CompanyPlacement = normalizedParentId
      ? { kind: "branch", parentCompanyId: normalizedParentId }
      : normalizedAccountId
        ? { kind: "account-company", accountCompanyId: normalizedAccountId }
        : { kind: "new-account" }

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

    // Erişim, rol, kota ve kayıt: hepsi tek yerde. Yeni hesaba 1 yıllık deneme AÇILMAZ —
    // modül yetkisi yalnız satın almayla gelir, abonelik satırı ilk ödemede oluşur.
    const company = await createCompany({
      actorUserId: user.id,
      placement,
      grantMembership: true,
      input: {
        name: String(name ?? ""),
        branchName: normalizeOptionalString(branchName),
        taxNumber: normalizeOptionalString(taxNumber),
        taxOffice: normalizeOptionalString(taxOffice),
        address: normalizeOptionalString(address),
        city: normalizeOptionalString(city),
        phone: normalizeOptionalString(phone),
        email: normalizeOptionalString(email),
        isEDonusumEnabled: Boolean(isEDonusumEnabled),
        sector: normalizeOptionalString(sector),
        businessModel: normalizeOptionalString(businessModel),
        employeeRange: normalizeOptionalString(employeeRange),
        monthlyInvoiceVolume: normalizeOptionalString(monthlyInvoiceVolume),
        primaryBusinessNeed: normalizeOptionalString(primaryBusinessNeed),
        usesEDonusumBefore: typeof usesEDonusumBefore === "boolean" ? usesEDonusumBefore : null,
        onboardingCompletedAt: parsedOnboardingCompletedAt,
      },
    })

    return NextResponse.json(company, { status: 201 })
  } catch (error) {
    // Kota/erişim/doğrulama hataları: kod ve durum ortak modülden gelir, uç yalnız iletir.
    if (error instanceof CompanyCreationError) {
      return NextResponse.json(
        { error: error.message, code: error.code, ...error.details },
        { status: error.status },
      )
    }

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

