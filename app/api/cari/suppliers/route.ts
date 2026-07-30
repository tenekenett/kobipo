import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { fetchSupplierList } from "@/lib/cari/list-query"

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

function toBool(value: unknown): boolean {
  if (value === true || value === 1) return true
  if (value === false || value === 0 || value === null || value === undefined || value === "") return false
  if (typeof value === "string") {
    const normalized = value.toLowerCase().trim()
    return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on"
  }
  return Boolean(value)
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
    const result = await fetchSupplierList({
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
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching suppliers:", error)
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
      classification1Id,
      classification2Id,
      authorizedUserId,
      isAlsoCustomer,
    } = body

    if (!companyId || !name) {
      return NextResponse.json(
        { error: "companyId and name are required" },
        { status: 400 }
      )
    }

    await ensureCompanyWrite(companyId)
    const parsedOpeningBalanceAmount =
      openingBalanceAmount !== undefined && openingBalanceAmount !== null && openingBalanceAmount !== ""
        ? Number(openingBalanceAmount)
        : 0
    const parsedRiskLimit = parseDecimalOrNull(riskLimit)
    const parsedOpeningBalanceType = parseOpeningBalanceType(openingBalanceType)

    const supplier = await prisma.$transaction(async (tx) => {
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

      const createdSupplier = await tx.supplier.create({
        data: {
          companyId,
          code,
          name,
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
          isAlsoCustomer: toBool(isAlsoCustomer),
        },
      })

      if (toBool(isAlsoCustomer)) {
        const linkedCustomer = await tx.customer.create({
          data: {
            companyId,
            code,
            name,
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
            isAlsoSupplier: true,
            linkedSupplierId: createdSupplier.id,
          },
        })

        return tx.supplier.update({
          where: { id: createdSupplier.id },
          data: { linkedCustomerId: linkedCustomer.id },
        })
      }

      return createdSupplier
    })

    return NextResponse.json(supplier, { status: 201 })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error creating supplier:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}


