import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { resolveCompanyId } from "@/lib/company/resolve-company"
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
    resolvedParams.id = (await resolveCompanyId(resolvedParams.id)) ?? resolvedParams.id
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
        eFaturaPrefix: true,
        eArchivePrefix: true,
        eDonusumTenantVkn: true,
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
        // Şube/ana firma ilişkisi (Şube Bilgileri ekranı için)
        parentCompanyId: true,
        parentCompany: { select: { id: true, name: true } },
        branches: { select: { id: true, name: true }, orderBy: { name: "asc" } },
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
    resolvedParams.id = (await resolveCompanyId(resolvedParams.id)) ?? resolvedParams.id
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
      eFaturaPrefix,
      eArchivePrefix,
      eDonusumTenantVkn,
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

    // Mükellef VKN'si (eDonusumTenantVkn) firma VKN'sinden gelir. Firma VKN'si
    // değiştiğinde, istekte açıkça gönderilmediyse mükellef VKN'sini de eşitle ki
    // eski/stale bir değer kontör (insertDocumentCredit) ve fatura akışını yanlış
    // VKN'ye yönlendirmesin. [[tenant.ts]] effectiveTenantVkn bu alanı önceler.
    const cleanVknDigits = (v: unknown) =>
      typeof v === "string" ? v.replace(/\D/g, "").slice(0, 11) : ""
    let tenantVknUpdate: string | null | undefined
    if (eDonusumTenantVkn !== undefined) {
      const c = cleanVknDigits(eDonusumTenantVkn)
      tenantVknUpdate = c ? c : null
    } else if (taxNumber !== undefined) {
      const existingCompany = await prisma.company.findUnique({
        where: { id: resolvedParams.id },
        select: { eDonusumTenantVkn: true },
      })
      const newTax = cleanVknDigits(taxNumber)
      if (newTax && newTax !== cleanVknDigits(existingCompany?.eDonusumTenantVkn)) {
        tenantVknUpdate = newTax
      }
    }

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
        eFaturaPrefix:
          eFaturaPrefix !== undefined
            ? (typeof eFaturaPrefix === "string" && eFaturaPrefix.trim()
                ? eFaturaPrefix.trim().toUpperCase().slice(0, 3)
                : null)
            : undefined,
        eArchivePrefix:
          eArchivePrefix !== undefined
            ? (typeof eArchivePrefix === "string" && eArchivePrefix.trim()
                ? eArchivePrefix.trim().toUpperCase().slice(0, 3)
                : null)
            : undefined,
        eDonusumTenantVkn: tenantVknUpdate,
        eDonusumIntegrator: eDonusumIntegrator || undefined,
        eDonusumProvider: eDonusumProvider || null,
        // Username/URL/Alias: form'da bu alan gönderilmediyse (undefined) DB'deki değeri
        // ezmiyoruz. Yalnızca açıkça boş string gönderilirse temizliyoruz. Bu sayede
        // Firma Ayarları'nın başka bir sekmesinden kaydetmek E-Dönüşüm credentials'ını
        // silmiyor (password için aynı koruma zaten vardı).
        eDonusumApiUsername:
          eDonusumApiUsername === undefined
            ? undefined
            : (typeof eDonusumApiUsername === "string" && eDonusumApiUsername.trim()
                ? eDonusumApiUsername.trim()
                : null),
        eDonusumApiPassword:
          typeof eDonusumApiPassword === "string" && eDonusumApiPassword.trim() && eDonusumApiPassword !== "***"
            ? encryptSecret(eDonusumApiPassword.trim())
            : undefined,
        eDonusumAlias:
          eDonusumAlias === undefined
            ? undefined
            : (typeof eDonusumAlias === "string" && eDonusumAlias.trim() ? eDonusumAlias.trim() : null),
        eDonusumApiUrl:
          eDonusumApiUrl === undefined
            ? undefined
            : (typeof eDonusumApiUrl === "string" && eDonusumApiUrl.trim() ? eDonusumApiUrl.trim() : null),
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

