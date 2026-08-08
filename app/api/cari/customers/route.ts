import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { toBool } from "@/lib/cari/repair-dual-role"
import { fetchCustomerList } from "@/lib/cari/list-query"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = 'force-dynamic'

function parseOpeningBalanceType(value: unknown) {
  return String(value || "").toUpperCase() === "CREDIT" ? "CREDIT" : "DEBIT"
}

function parsePaymentDueDays(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseDecimalOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}


export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    const search = searchParams.get("search")
    const page = Number(searchParams.get("page") || "1")
    const pageSize = Number(searchParams.get("pageSize") || "50")
    const usePagination = searchParams.has("page") || searchParams.has("pageSize")

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    // Sorgu ve bakiye formülü lib/cari/list-query.ts'te — dışa aktarma da aynı
    // fonksiyonu çağırır, böylece ekran ile indirilen dosya asla ayrışmaz.
    const result = await fetchCustomerList({
      companyId,
      search,
      page,
      pageSize,
      paginate: usePagination,
    })

    if (usePagination) {
      return NextResponse.json({
        items: result.items,
        totalCount: result.totalCount ?? 0,
        page: result.page,
        pageSize: result.pageSize,
      })
    }

    return NextResponse.json(result.items)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error fetching customers:", error)
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
    body.companyId = await resolveCompanyId(body.companyId)
    const {
      companyId,
      code,
      name,
      nickname,
      taxNumber,
      taxOffice,
      address,
      city,
      district,
      phone,
      email,
      contactPerson,
      eInvoiceAlias,
      paymentDueDays,
      openingBalanceAmount,
      openingBalanceType,
      riskLimit,
      bankInfo,
      note,
      branches,
      classification1Id,
      classification2Id,
      authorizedUserId,
      isAlsoSupplier,
    } = body

    if (!companyId || !name) {
      return NextResponse.json(
        { error: "companyId and name are required" },
        { status: 400 }
      )
    }

    await ensureCompanyWrite(companyId)
    // Takma ad: boş/whitespace ise NULL yaz ki liste ve arama boş string'e takılmasın.
    const normalizedNickname =
      typeof nickname === "string" && nickname.trim() ? nickname.trim() : null
    const parsedOpeningBalanceAmount =
      openingBalanceAmount !== undefined && openingBalanceAmount !== null && openingBalanceAmount !== ""
        ? Number(openingBalanceAmount)
        : 0
    const parsedRiskLimit = parseDecimalOrNull(riskLimit)
    const parsedOpeningBalanceType = parseOpeningBalanceType(openingBalanceType)
    const sanitizedBranches = Array.isArray(branches)
      ? branches
          .map((branch) => ({
            name: String(branch?.name || "").trim(),
            address: branch?.address ? String(branch.address).trim() : null,
          }))
          .filter((branch) => branch.name.length > 0)
      : []

    const customer = await prisma.$transaction(async (tx) => {
      const normalizedClassification1Id = classification1Id ? String(classification1Id) : null
      const normalizedClassification2Id = classification2Id ? String(classification2Id) : null
      const normalizedAuthorizedUserId = authorizedUserId ? String(authorizedUserId) : null

      if (normalizedClassification1Id) {
        const classification1 = await tx.companyDefinition.findFirst({
          where: { id: normalizedClassification1Id, companyId, type: "CLASS_1", isActive: true },
          select: { id: true },
        })
        if (!classification1) throw new Error("Sınıflandırma 1 kaydı bulunamadı")
      }
      if (normalizedClassification2Id) {
        const classification2 = await tx.companyDefinition.findFirst({
          where: { id: normalizedClassification2Id, companyId, type: "CLASS_2", isActive: true },
          select: { id: true },
        })
        if (!classification2) throw new Error("Sınıflandırma 2 kaydı bulunamadı")
      }
      if (normalizedAuthorizedUserId) {
        const member = await tx.userCompany.findFirst({
          where: { companyId, userId: normalizedAuthorizedUserId },
          select: { id: true },
        })
        if (!member) throw new Error("Seçilen çalışan bu firmaya ait değil")
      }

      const createdCustomer = await tx.customer.create({
        data: {
          companyId,
          code,
          name,
          nickname: normalizedNickname,
          taxNumber,
          taxOffice,
          address,
          city,
          district,
          phone,
          email,
          contactPerson,
          eInvoiceAlias: eInvoiceAlias ?? null,
          paymentDueDays: parsePaymentDueDays(paymentDueDays),
          openingBalanceAmount: Number.isFinite(parsedOpeningBalanceAmount) ? parsedOpeningBalanceAmount : 0,
          openingBalanceType: parsedOpeningBalanceType,
          riskLimit: parsedRiskLimit,
          bankInfo: bankInfo ?? null,
          note: note ?? null,
          classification1Id: normalizedClassification1Id,
          classification2Id: normalizedClassification2Id,
          authorizedUserId: normalizedAuthorizedUserId,
          isAlsoSupplier: toBool(isAlsoSupplier),
          branches:
            sanitizedBranches.length > 0
              ? {
                  createMany: {
                    data: sanitizedBranches,
                  },
                }
              : undefined,
        },
      })

      if (toBool(isAlsoSupplier)) {
        const linkedSupplier = await tx.supplier.create({
          data: {
            companyId,
            code,
            name,
            // Aynı kişinin tedarikçi kaydı: takma ad da aynalanır.
            nickname: normalizedNickname,
            taxNumber,
            taxOffice,
            address,
            city,
            district,
            phone,
            email,
            contactPerson,
            eInvoiceAlias: eInvoiceAlias ?? null,
            paymentDueDays: parsePaymentDueDays(paymentDueDays),
            openingBalanceAmount: Number.isFinite(parsedOpeningBalanceAmount) ? parsedOpeningBalanceAmount : 0,
            openingBalanceType: parsedOpeningBalanceType,
            riskLimit: parsedRiskLimit,
            bankInfo: bankInfo ?? null,
            note: note ?? null,
            classification1Id: normalizedClassification1Id,
            classification2Id: normalizedClassification2Id,
            authorizedUserId: normalizedAuthorizedUserId,
            isAlsoCustomer: true,
            linkedCustomerId: createdCustomer.id,
          },
        })

        return tx.customer.update({
          where: { id: createdCustomer.id },
          data: { linkedSupplierId: linkedSupplier.id },
        })
      }

      return createdCustomer
    })

    return NextResponse.json(customer, { status: 201 })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error creating customer:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

