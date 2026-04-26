import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = 'force-dynamic'


export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userCompanies = await prisma.userCompany.findMany({
      where: {
        userId: user.id,
      },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            taxNumber: true,
            taxOffice: true,
            address: true,
            city: true,
            country: true,
            phone: true,
            email: true,
            website: true,
            isEDonusumEnabled: true,
            invoiceSeriesPrefix: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    })

    const companies = userCompanies.map((uc) => uc.company)

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
    } = body

    const trimmedName = String(name || "").trim()
    if (!trimmedName) {
      return NextResponse.json(
        { error: "Firma adı zorunludur" },
        { status: 400 }
      )
    }

    const userCompanyCount = await prisma.userCompany.count({
      where: { userId: user.id },
    })

    const currentSubscription = await prisma.subscription.findFirst({
      where: {
        userId: user.id,
        status: { in: ["TRIAL", "ACTIVE"] },
      },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
    })

    const currentMaxCompanies = currentSubscription?.plan?.maxCompanies ?? 1
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
          taxNumber,
          taxOffice,
          address,
          city,
          phone,
          email,
          isEDonusumEnabled: Boolean(isEDonusumEnabled),
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
    console.error("Error creating company:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

