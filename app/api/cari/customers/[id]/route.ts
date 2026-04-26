import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { supplierHasBusinessReferences } from "@/lib/cari/dual-role"


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
    const customer = await prisma.customer.findUnique({
      where: { id: resolvedParams.id },
      include: {
        invoices: {
          orderBy: { date: "desc" },
          take: 10,
        },
        transactions: {
          orderBy: { date: "desc" },
          take: 10,
        },
      },
    })

    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 })
    }

    await ensureCompanyAccess(customer.companyId)

    // Get all invoices and payments
    const allInvoices = await prisma.invoice.findMany({
      where: { customerId: customer.id },
      include: {
        payments: {
          select: {
            amount: true,
          },
        },
      },
    })

    const transactions = await prisma.transaction.findMany({
      where: { customerId: customer.id },
      include: {
        account: true,
      },
    })

    // Calculate balance (unpaid invoices - payments)
    let balance = 0
    allInvoices.forEach((inv) => {
      if (inv.type === "SALES") {
        const totalPaid = inv.payments.reduce((sum, p) => sum + Number(p.amount), 0)
        balance += Number(inv.totalAmount) - totalPaid
      }
    })

    transactions.forEach((trx) => {
      if (trx.type === "INCOME") {
        balance -= Number(trx.amount)
      } else {
        balance += Number(trx.amount)
      }
    })

    // Format transactions for display
    const formattedTransactions = [
      ...allInvoices.map((inv) => ({
        id: inv.id,
        date: inv.date.toISOString(),
        type: "INVOICE",
        description: `Fatura ${inv.invoiceNo}`,
        debit: inv.type === "SALES" ? Number(inv.totalAmount) : 0,
        credit: 0,
        balance: 0,
        invoiceNo: inv.invoiceNo,
      })),
      ...transactions.map((trx) => ({
        id: trx.id,
        date: trx.date.toISOString(),
        type: trx.type === "INCOME" ? "PAYMENT" : "EXPENSE",
        description: trx.description || `${trx.type} - ${trx.account?.name || ""}`,
        debit: 0,
        credit: trx.type === "INCOME" ? Number(trx.amount) : 0,
        balance: 0,
        invoiceNo: null,
      })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    // Calculate running balance
    let runningBalance = 0
    formattedTransactions.forEach((tx) => {
      runningBalance += tx.debit - tx.credit
      tx.balance = runningBalance
    })

    return NextResponse.json({
      ...customer,
      balance,
      totalDebit: formattedTransactions.reduce((sum, t) => sum + t.debit, 0),
      totalCredit: formattedTransactions.reduce((sum, t) => sum + t.credit, 0),
      invoiceCount: allInvoices.length,
      transactions: formattedTransactions,
    })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching customer:", error)
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
    const customer = await prisma.customer.findUnique({
      where: { id: resolvedParams.id },
    })

    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 })
    }

    await ensureCompanyAccess(customer.companyId)

    const body = await request.json()
    const {
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

    const paymentDueDaysVal =
      paymentDueDays !== undefined && paymentDueDays !== "" && paymentDueDays !== null
        ? Number(paymentDueDays)
        : null

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.customer.findUnique({
        where: { id: resolvedParams.id },
      })
      if (!current) throw new Error("Customer not found")

      const merged = {
        code: code !== undefined ? code : current.code,
        name: name !== undefined ? name : current.name,
        taxNumber: taxNumber !== undefined ? taxNumber : current.taxNumber,
        taxOffice: taxOffice !== undefined ? taxOffice : current.taxOffice,
        address: address !== undefined ? address : current.address,
        city: city !== undefined ? city : current.city,
        phone: phone !== undefined ? phone : current.phone,
        email: email !== undefined ? email : current.email,
        contactPerson: contactPerson !== undefined ? contactPerson : current.contactPerson,
        paymentDueDays:
          paymentDueDays !== undefined
            ? paymentDueDaysVal
            : current.paymentDueDays,
      }

      let linkedSupplierId = current.linkedSupplierId
      let nextIsAlsoSupplier =
        isAlsoSupplier !== undefined ? Boolean(isAlsoSupplier) : current.isAlsoSupplier

      if (isAlsoSupplier === false && current.linkedSupplierId) {
        const sid = current.linkedSupplierId
        await tx.customer.update({
          where: { id: current.id },
          data: { linkedSupplierId: null, isAlsoSupplier: false },
        })
        linkedSupplierId = null
        nextIsAlsoSupplier = false
        const hasRefs = await supplierHasBusinessReferences(tx, sid)
        if (hasRefs) {
          await tx.supplier.update({
            where: { id: sid },
            data: { linkedCustomerId: null, isAlsoCustomer: false },
          })
        } else {
          await tx.supplier.delete({ where: { id: sid } })
        }
      }

      /* nextIsAlsoSupplier: bayrak true ama link yoksa (yetim) tedarikçi oluştur — sadece === true değil */
      if (nextIsAlsoSupplier && !linkedSupplierId) {
        const linkedSupplier = await tx.supplier.create({
          data: {
            companyId: current.companyId,
            code: merged.code,
            name: merged.name,
            taxNumber: merged.taxNumber,
            taxOffice: merged.taxOffice,
            address: merged.address,
            city: merged.city,
            phone: merged.phone,
            email: merged.email,
            contactPerson: merged.contactPerson,
            paymentDueDays: merged.paymentDueDays,
            isAlsoCustomer: true,
            linkedCustomerId: current.id,
          },
        })
        linkedSupplierId = linkedSupplier.id
        nextIsAlsoSupplier = true
      }

      const saved = await tx.customer.update({
        where: { id: resolvedParams.id },
        data: {
          code: merged.code,
          name: merged.name,
          taxNumber: merged.taxNumber,
          taxOffice: merged.taxOffice,
          address: merged.address,
          city: merged.city,
          phone: merged.phone,
          email: merged.email,
          contactPerson: merged.contactPerson,
          paymentDueDays: merged.paymentDueDays,
          isAlsoSupplier: nextIsAlsoSupplier,
          linkedSupplierId,
        },
      })

      if (saved.linkedSupplierId) {
        await tx.supplier.update({
          where: { id: saved.linkedSupplierId },
          data: {
            code: saved.code,
            name: saved.name,
            taxNumber: saved.taxNumber,
            taxOffice: saved.taxOffice,
            address: saved.address,
            city: saved.city,
            phone: saved.phone,
            email: saved.email,
            contactPerson: saved.contactPerson,
            paymentDueDays: saved.paymentDueDays,
            isAlsoCustomer: true,
            linkedCustomerId: saved.id,
          },
        })
      }

      return saved
    })

    return NextResponse.json(updated)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error updating customer:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    const customer = await prisma.customer.findUnique({
      where: { id: resolvedParams.id },
    })

    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 })
    }

    await ensureCompanyAccess(customer.companyId)

    await prisma.customer.delete({
      where: { id: resolvedParams.id },
    })

    return NextResponse.json({ message: "Customer deleted" })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error deleting customer:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

