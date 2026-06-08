import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { getUserContext } from "@/lib/auth/user-context"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
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


export async function GET(request: Request) {
  try {
    const context = await getUserContext()
    if (!context) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Pasif firmalar normal kullanıcının erişilebilir firma listesinde görünmez;
    // yalnızca super admin tüm firmalarını görür.
    const companies = context.companies
      .filter((c) => context.isSuperAdmin || c.isActive)
      .map((c) => ({
        id: c.companyId,
        name: c.companyName,
        isEDonusumEnabled: c.isEDonusumEnabled,
        disabledModules: c.disabledModules,
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
    } = body

    const trimmedName = String(name || "").trim()
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

    if (userCompanyCount >= currentMaxCompanies) {
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
          taxNumber: normalizedTaxNumber,
          taxOffice: normalizedTaxOffice,
          address: normalizedAddress,
          city: normalizedCity,
          phone: normalizedPhone,
          email: normalizedEmail,
          isEDonusumEnabled: Boolean(isEDonusumEnabled),
          sector: normalizedSector,
          businessModel: normalizedBusinessModel,
          employeeRange: normalizedEmployeeRange,
          monthlyInvoiceVolume: normalizedMonthlyInvoiceVolume,
          primaryBusinessNeed: normalizedPrimaryBusinessNeed,
          usesEDonusumBefore:
            typeof usesEDonusumBefore === "boolean" ? usesEDonusumBefore : null,
          onboardingCompletedAt: parsedOnboardingCompletedAt,
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

      if (userCompanyCount === 0) {
        const now = new Date()
        const trialEndsAt = new Date(now)
        trialEndsAt.setFullYear(trialEndsAt.getFullYear() + 1)

        const freePlan = await tx.plan.upsert({
          where: { code: "FREE_1Y" },
          update: {
            name: "Ucretsiz (1 Yil)",
            monthlyPrice: 0,
            maxCompanies: 1,
            maxUsers: 1,
            maxInvoicesPerMonth: 100,
            isActive: true,
          },
          create: {
            code: "FREE_1Y",
            name: "Ucretsiz (1 Yil)",
            monthlyPrice: 0,
            maxCompanies: 1,
            maxUsers: 1,
            maxInvoicesPerMonth: 100,
            isActive: true,
          },
        })

        await tx.subscription.create({
          data: {
            userId: user.id,
            companyId: createdCompany.id,
            planId: freePlan.id,
            provider: "NONE",
            status: "TRIAL",
            trialEndsAt,
            periodStart: now,
            periodEnd: trialEndsAt,
          },
        })
      }

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

