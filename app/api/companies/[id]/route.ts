import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { encryptSecret } from "@/lib/crypto/secrets"


export const dynamic = 'force-dynamic'
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    await ensureCompanyAccess(resolvedParams.id)

    const company = await prisma.company.findUnique({
      where: { id: resolvedParams.id },
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
        eDonusumIntegrator: true,
        eDonusumProvider: true,
        eDonusumApiUsername: true,
        eDonusumApiPassword: true,
        eDonusumAlias: true,
        eDonusumApiUrl: true,
        eDonusumLastTestedAt: true,
        eDonusumLastTestSuccess: true,
        invoiceSeriesPrefix: true,
        sector: true,
        businessModel: true,
        employeeRange: true,
        monthlyInvoiceVolume: true,
        primaryBusinessNeed: true,
        usesEDonusumBefore: true,
        onboardingCompletedAt: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 })
    }

    return NextResponse.json({
      ...company,
      eDonusumApiPassword: company.eDonusumApiPassword ? "***" : "",
    })
  } catch (error: any) {
    if (error.message === "Unauthorized" || error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching company:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    await ensureCompanyAccess(resolvedParams.id)

    const body = await request.json()
    const {
      name,
      taxNumber,
      taxOffice,
      address,
      city,
      phone,
      email,
      website,
      isEDonusumEnabled,
      invoiceSeriesPrefix,
      eDonusumIntegrator,
      eDonusumProvider,
      eDonusumApiUsername,
      eDonusumApiPassword,
      eDonusumAlias,
      eDonusumApiUrl,
      eDonusumLastTestedAt,
      eDonusumLastTestSuccess,
      sector,
      businessModel,
      employeeRange,
      monthlyInvoiceVolume,
      primaryBusinessNeed,
      usesEDonusumBefore,
      onboardingCompletedAt,
    } = body

    const company = await prisma.company.update({
      where: { id: resolvedParams.id },
      data: {
        name,
        taxNumber,
        taxOffice,
        address,
        city,
        phone,
        email,
        website,
        isEDonusumEnabled: isEDonusumEnabled !== undefined ? Boolean(isEDonusumEnabled) : undefined,
        invoiceSeriesPrefix: invoiceSeriesPrefix || null,
        eDonusumIntegrator: eDonusumIntegrator || undefined,
        eDonusumProvider: eDonusumProvider || null,
        eDonusumApiUsername: eDonusumApiUsername || null,
        eDonusumApiPassword:
          typeof eDonusumApiPassword === "string" && eDonusumApiPassword.trim() && eDonusumApiPassword !== "***"
            ? encryptSecret(eDonusumApiPassword.trim())
            : undefined,
        eDonusumAlias: eDonusumAlias || null,
        eDonusumApiUrl: eDonusumApiUrl || null,
        eDonusumLastTestedAt: eDonusumLastTestedAt ? new Date(eDonusumLastTestedAt) : undefined,
        eDonusumLastTestSuccess:
          typeof eDonusumLastTestSuccess === "boolean" ? eDonusumLastTestSuccess : undefined,
        sector: sector || null,
        businessModel: businessModel || null,
        employeeRange: employeeRange || null,
        monthlyInvoiceVolume: monthlyInvoiceVolume || null,
        primaryBusinessNeed: primaryBusinessNeed || null,
        usesEDonusumBefore:
          typeof usesEDonusumBefore === "boolean" ? usesEDonusumBefore : null,
        onboardingCompletedAt: onboardingCompletedAt ? new Date(onboardingCompletedAt) : undefined,
      },
    })

    return NextResponse.json(company)
  } catch (error: any) {
    if (error.message === "Unauthorized" || error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error updating company:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

