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

    // Calculate balance
    const invoices = await prisma.invoice.findMany({
      where: { customerId: customer.id },
    })

    const transactions = await prisma.transaction.findMany({
      where: { customerId: customer.id },
    })

    let balance = 0
    invoices.forEach((inv) => {
      if (inv.type === "SALES") {
        balance += Number(inv.totalAmount)
      } else {
        balance -= Number(inv.totalAmount)
      }
    })

    transactions.forEach((trx) => {
      if (trx.type === "INCOME") {
        balance -= Number(trx.amount)
      } else {
        balance += Number(trx.amount)
      }
    })

    return NextResponse.json({
      ...customer,
      balance,
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
    } = body

    const updated = await prisma.customer.update({
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

