import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get("companyId")
    const customerId = searchParams.get("customerId")
    const supplierId = searchParams.get("supplierId")
    const startDate = searchParams.get("startDate")
    const endDate = searchParams.get("endDate")

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    const where: any = {
      companyId,
    }

    if (customerId) {
      where.customerId = customerId
    }

    if (supplierId) {
      where.supplierId = supplierId
    }

    if (startDate || endDate) {
      where.date = {}
      if (startDate) {
        where.date.gte = new Date(startDate)
      }
      if (endDate) {
        where.date.lte = new Date(endDate)
      }
    }

    const invoices = await prisma.invoice.findMany({
      where,
      include: {
        customer: true,
        supplier: true,
        items: true,
      },
      orderBy: { date: "desc" },
    })

    const transactions = await prisma.transaction.findMany({
      where: {
        companyId,
        ...(customerId && { customerId }),
        ...(supplierId && { supplierId }),
        ...(startDate || endDate
          ? {
              date: {
                ...(startDate && { gte: new Date(startDate) }),
                ...(endDate && { lte: new Date(endDate) }),
              },
            }
          : {}),
      },
      include: {
        account: true,
        customer: true,
        supplier: true,
      },
      orderBy: { date: "desc" },
    })

    const checks = await prisma.check.findMany({
      where: {
        companyId,
        ...(customerId && { customerId }),
        ...(supplierId && { supplierId }),
        ...(startDate || endDate
          ? {
              dueDate: {
                ...(startDate && { gte: new Date(startDate) }),
                ...(endDate && { lte: new Date(endDate) }),
              },
            }
          : {}),
      },
      orderBy: { dueDate: "desc" },
    })

    const promissoryNotes = await prisma.promissoryNote.findMany({
      where: {
        companyId,
        ...(customerId && { customerId }),
        ...(supplierId && { supplierId }),
        ...(startDate || endDate
          ? {
              dueDate: {
                ...(startDate && { gte: new Date(startDate) }),
                ...(endDate && { lte: new Date(endDate) }),
              },
            }
          : {}),
      },
      orderBy: { dueDate: "desc" },
    })

    // Combine and sort by date
    const entries = [
      ...invoices.map((inv) => ({
        type: "INVOICE",
        id: inv.id,
        date: inv.date,
        description: `Fatura ${inv.invoiceNo}`,
        debit: inv.type === "SALES" ? Number(inv.totalAmount) : 0,
        credit: inv.type === "PURCHASE" ? Number(inv.totalAmount) : 0,
        balance: 0,
        reference: inv.invoiceNo,
        data: inv,
      })),
      ...transactions.map((trx) => ({
        type: "TRANSACTION",
        id: trx.id,
        date: trx.date,
        description: trx.description || `${trx.type} - ${trx.account.name}`,
        // Cari ekstrede ödeme (EXPENSE) cariyi borçlandırır → BORÇ sütunu;
        // tahsilat (INCOME) cariyi alacaklandırır → ALACAK sütunu. Fatura tarafıyla
        // tutarlı (SALES→borç, PURCHASE→alacak): müşteri tahsilatı bakiyeyi azaltır,
        // tedarikçi ödemesi borcu azaltır.
        debit: trx.type === "EXPENSE" ? Number(trx.amount) : 0,
        credit: trx.type === "INCOME" ? Number(trx.amount) : 0,
        balance: 0,
        reference: trx.reference,
        data: trx,
      })),
      ...checks.map((check) => ({
        type: "CHECK",
        id: check.id,
        date: check.dueDate,
        description: `Çek ${check.checkNo}`,
        debit: check.customerId ? Number(check.amount) : 0,
        credit: check.supplierId ? Number(check.amount) : 0,
        balance: 0,
        reference: check.checkNo,
        data: check,
      })),
      ...promissoryNotes.map((note) => ({
        type: "PROMISSORY_NOTE",
        id: note.id,
        date: note.dueDate,
        description: `Senet ${note.noteNo}`,
        debit: note.customerId ? Number(note.amount) : 0,
        credit: note.supplierId ? Number(note.amount) : 0,
        balance: 0,
        reference: note.noteNo,
        data: note,
      })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    // Calculate running balance
    let runningBalance = 0
    entries.forEach((entry) => {
      runningBalance += entry.debit - entry.credit
      entry.balance = runningBalance
    })

    const now = new Date()
    const aging = {
      current: 0,
      days_0_30: 0,
      days_31_60: 0,
      days_61_90: 0,
      days_90_plus: 0,
    }

    entries.forEach((entry) => {
      const openAmount = entry.debit - entry.credit
      if (openAmount === 0) return
      const ageDays = Math.floor((now.getTime() - new Date(entry.date).getTime()) / (1000 * 60 * 60 * 24))
      if (ageDays < 0) {
        aging.current += openAmount
      } else if (ageDays <= 30) {
        aging.days_0_30 += openAmount
      } else if (ageDays <= 60) {
        aging.days_31_60 += openAmount
      } else if (ageDays <= 90) {
        aging.days_61_90 += openAmount
      } else {
        aging.days_90_plus += openAmount
      }
    })

    return NextResponse.json({
      entries,
      totalDebit: entries.reduce((sum, e) => sum + e.debit, 0),
      totalCredit: entries.reduce((sum, e) => sum + e.credit, 0),
      finalBalance: runningBalance,
      aging,
    })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching ekstre:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

