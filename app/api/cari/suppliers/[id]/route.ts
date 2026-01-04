import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"


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
    const supplier = await prisma.supplier.findUnique({
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

    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 })
    }

    await ensureCompanyAccess(supplier.companyId)

    // Get all invoices and payments
    const allInvoices = await prisma.invoice.findMany({
      where: { supplierId: supplier.id },
      include: {
        payments: {
          select: {
            amount: true,
          },
        },
      },
    })

    const transactions = await prisma.transaction.findMany({
      where: { supplierId: supplier.id },
      include: {
        account: true,
      },
    })

    // Calculate balance (unpaid invoices - payments)
    let balance = 0
    allInvoices.forEach((inv) => {
      if (inv.type === "PURCHASE") {
        const totalPaid = inv.payments.reduce((sum, p) => sum + Number(p.amount), 0)
        balance += Number(inv.totalAmount) - totalPaid
      }
    })

    transactions.forEach((trx) => {
      if (trx.type === "EXPENSE") {
        balance += Number(trx.amount)
      } else {
        balance -= Number(trx.amount)
      }
    })

    // Format transactions for display
    const formattedTransactions = [
      ...allInvoices.map((inv) => ({
        id: inv.id,
        date: inv.date.toISOString(),
        type: "INVOICE",
        description: `Fatura ${inv.invoiceNo}`,
        debit: 0,
        credit: inv.type === "PURCHASE" ? Number(inv.totalAmount) : 0,
        balance: 0,
        invoiceNo: inv.invoiceNo,
      })),
      ...transactions.map((trx) => ({
        id: trx.id,
        date: trx.date.toISOString(),
        type: trx.type === "EXPENSE" ? "PAYMENT" : "INCOME",
        description: trx.description || `${trx.type} - ${trx.account?.name || ""}`,
        debit: trx.type === "EXPENSE" ? Number(trx.amount) : 0,
        credit: 0,
        balance: 0,
        invoiceNo: null,
      })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    // Calculate running balance
    let runningBalance = 0
    formattedTransactions.forEach((tx) => {
      runningBalance += tx.credit - tx.debit
      tx.balance = runningBalance
    })

    return NextResponse.json({
      ...supplier,
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
    console.error("Error fetching supplier:", error)
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
    const supplier = await prisma.supplier.findUnique({
      where: { id: resolvedParams.id },
    })

    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 })
    }

    await ensureCompanyAccess(supplier.companyId)

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
    } = body

    const updated = await prisma.supplier.update({
      where: { id: resolvedParams.id },
      data: {
        code,
        name,
        taxNumber,
        taxOffice,
        address,
        city,
        phone,
        email,
        contactPerson,
      },
    })

    return NextResponse.json(updated)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error updating supplier:", error)
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
    const supplier = await prisma.supplier.findUnique({
      where: { id: resolvedParams.id },
    })

    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 })
    }

    await ensureCompanyAccess(supplier.companyId)

    await prisma.supplier.delete({
      where: { id: resolvedParams.id },
    })

    return NextResponse.json({ message: "Supplier deleted" })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error deleting supplier:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

