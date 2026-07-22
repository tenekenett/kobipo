import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { resolveSlugId } from "@/lib/slug-resolve"


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
    resolvedParams.id = await resolveSlugId("financialAccount", resolvedParams.id, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))
    const account = await prisma.financialAccount.findUnique({
      where: { id: resolvedParams.id },
      include: {
        transactions: {
          orderBy: { date: "desc" },
          take: 100,
          include: {
            customer: { select: { id: true, name: true } },
            supplier: { select: { id: true, name: true } },
          },
        },
        _count: { select: { transactions: true } },
      },
    })

    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 })
    }

    await ensureCompanyAccess(account.companyId)

    // Bordro bağlantısı olan işlemleri tek sorguda işaretle — UI'da silme
    // butonunu gizlemek ve "Bordro" rozetini göstermek için.
    const txIds = account.transactions.map((t) => t.id)
    const linkedPayrollRows =
      txIds.length > 0
        ? await prisma.payrollRecord.findMany({
            where: { transactionId: { in: txIds } },
            select: { transactionId: true, periodMonth: true, periodYear: true },
          })
        : []
    const payrollByTx = new Map(linkedPayrollRows.map((p) => [p.transactionId, p]))

    const transactionsWithMeta = account.transactions.map((tx) => {
      const linkedPayroll = payrollByTx.get(tx.id)
      return {
        ...tx,
        linkedPayroll: linkedPayroll
          ? { periodMonth: linkedPayroll.periodMonth, periodYear: linkedPayroll.periodYear }
          : null,
      }
    })

    return NextResponse.json({ ...account, transactions: transactionsWithMeta })
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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    resolvedParams.id = await resolveSlugId("financialAccount", resolvedParams.id, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))
    const account = await prisma.financialAccount.findUnique({
      where: { id: resolvedParams.id },
    })

    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 })
    }

    await ensureCompanyWrite(account.companyId)

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
      where: { id: resolvedParams.id },
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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    resolvedParams.id = await resolveSlugId("financialAccount", resolvedParams.id, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))
    const account = await prisma.financialAccount.findUnique({
      where: { id: resolvedParams.id },
    })

    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 })
    }

    await ensureCompanyWrite(account.companyId)

    await prisma.financialAccount.update({
      where: { id: resolvedParams.id },
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

