import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { repairOrphanDualRoleCustomers, toBool } from "@/lib/cari/repair-dual-role"

export const dynamic = 'force-dynamic'


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

    await repairOrphanDualRoleCustomers(companyId)

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

    const customers = await prisma.customer.findMany({
      where,
      include: {
        invoices: {
          where: { type: "SALES" },
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

    const customersWithBalance = customers.map((customer) => {
      const invoiceBalance = customer.invoices.reduce((sum, inv) => {
        const paid = inv.payments.reduce((paymentSum, p) => paymentSum + Number(p.amount), 0)
        return sum + (Number(inv.totalAmount) - paid)
      }, 0)

      const transactionEffect = customer.transactions.reduce((sum, trx) => {
        return trx.type === "INCOME" ? sum - Number(trx.amount) : sum + Number(trx.amount)
      }, 0)

      return {
        ...customer,
        balance: invoiceBalance + transactionEffect,
      }
    })

    return NextResponse.json(customersWithBalance)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
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
      isAlsoSupplier,
    } = body

    if (!companyId || !name) {
      return NextResponse.json(
        { error: "companyId and name are required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    const customer = await prisma.$transaction(async (tx) => {
      const createdCustomer = await tx.customer.create({
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
          paymentDueDays: paymentDueDays ? Number(paymentDueDays) : null,
          isAlsoSupplier: toBool(isAlsoSupplier),
        },
      })

      if (toBool(isAlsoSupplier)) {
        const linkedSupplier = await tx.supplier.create({
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
            paymentDueDays: paymentDueDays ? Number(paymentDueDays) : null,
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
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error creating customer:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

