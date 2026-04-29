import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { repairOrphanDualRoleSuppliers, toBool } from "@/lib/cari/repair-dual-role"

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
    const companyId = searchParams.get("companyId")
    const search = searchParams.get("search")

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    await repairOrphanDualRoleSuppliers(companyId)

    const where: any = {
      companyId,
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
        { taxNumber: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ]
    }

    const suppliers = await prisma.supplier.findMany({
      where,
      include: {
        invoices: {
          where: { type: "PURCHASE" },
          select: {
            totalAmount: true,
            payments: {
              select: { amount: true },
            },
          },
        },
        transactions: {
          select: {
            type: true,
            amount: true,
          },
        },
      },
      orderBy: { name: "asc" },
    })

    const suppliersWithBalance = suppliers.map((supplier) => {
      const invoiceBalance = supplier.invoices.reduce((sum, inv) => {
        const paid = inv.payments.reduce((paymentSum, p) => paymentSum + Number(p.amount), 0)
        return sum + (Number(inv.totalAmount) - paid)
      }, 0)

      const transactionEffect = supplier.transactions.reduce((sum, trx) => {
        return trx.type === "EXPENSE" ? sum + Number(trx.amount) : sum - Number(trx.amount)
      }, 0)

      return {
        ...supplier,
        balance:
          invoiceBalance +
          transactionEffect +
          (supplier.openingBalanceType === "CREDIT"
            ? -Number(supplier.openingBalanceAmount)
            : Number(supplier.openingBalanceAmount)),
      }
    })

    return NextResponse.json(suppliersWithBalance)
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
    const {
      companyId,
      code,
      name,
      taxNumber,
      taxOffice,
      address,
      city,
      phone,
      email,
      contactPerson,
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

    await ensureCompanyAccess(companyId)
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
          phone,
          email,
          contactPerson,
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
            phone,
            email,
            contactPerson,
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

