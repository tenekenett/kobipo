import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"


export const dynamic = 'force-dynamic'
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const account = await prisma.financialAccount.findUnique({
      where: { id: params.id },
      include: {
        transactions: {
          orderBy: { date: "desc" },
          take: 50,
        },
      },
    })

    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 })
    }

    await ensureCompanyAccess(account.companyId)

    return NextResponse.json(account)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching account:", error)
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

    const account = await prisma.financialAccount.findUnique({
      where: { id: params.id },
    })

    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 })
    }

    await ensureCompanyAccess(account.companyId)

    const body = await request.json()
    const {
      code,
      name,
      type,
      bankName,
      accountNumber,
      iban,
      currency,
      isActive,
    } = body

    const updated = await prisma.financialAccount.update({
      where: { id: params.id },
      data: {
        code,
        name,
        type,
        bankName,
        accountNumber,
        iban,
        currency,
        isActive: isActive !== undefined ? isActive : account.isActive,
      },
    })

    return NextResponse.json(updated)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error updating account:", error)
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

    const account = await prisma.financialAccount.findUnique({
      where: { id: params.id },
    })

    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 })
    }

    await ensureCompanyAccess(account.companyId)

    await prisma.financialAccount.update({
      where: { id: params.id },
      data: {
        isActive: false,
      },
    })

    return NextResponse.json({ message: "Account deactivated" })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error deleting account:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

