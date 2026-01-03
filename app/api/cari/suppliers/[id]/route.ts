import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supplier = await prisma.supplier.findUnique({
      where: { id: params.id },
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

    // Calculate balance
    const invoices = await prisma.invoice.findMany({
      where: { supplierId: supplier.id },
    })

    const transactions = await prisma.transaction.findMany({
      where: { supplierId: supplier.id },
    })

    let balance = 0
    invoices.forEach((inv) => {
      if (inv.type === "PURCHASE") {
        balance += Number(inv.totalAmount)
      } else {
        balance -= Number(inv.totalAmount)
      }
    })

    transactions.forEach((trx) => {
      if (trx.type === "EXPENSE") {
        balance += Number(trx.amount)
      } else {
        balance -= Number(trx.amount)
      }
    })

    return NextResponse.json({
      ...supplier,
      balance,
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
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supplier = await prisma.supplier.findUnique({
      where: { id: params.id },
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
      where: { id: params.id },
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
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supplier = await prisma.supplier.findUnique({
      where: { id: params.id },
    })

    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 })
    }

    await ensureCompanyAccess(supplier.companyId)

    await prisma.supplier.delete({
      where: { id: params.id },
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

