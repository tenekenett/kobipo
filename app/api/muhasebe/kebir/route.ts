import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    const startDate = searchParams.get("startDate")
    const endDate = searchParams.get("endDate")

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    const where: any = { companyId }
    if (startDate && endDate) {
      where.date = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      }
    }

    const entries = await prisma.accountingEntry.findMany({
      where,
      include: {
        debitAccount: true,
        creditAccount: true,
      },
    })

    // Hesap bazlı toplamları hesapla
    const accountMap = new Map<string, { code: string; name: string; debit: number; credit: number }>()

    entries.forEach((entry) => {
      // Borç hesabı
      const debitKey = entry.debitAccountId
      if (!accountMap.has(debitKey)) {
        accountMap.set(debitKey, {
          code: entry.debitAccount.code,
          name: entry.debitAccount.name,
          debit: 0,
          credit: 0,
        })
      }
      const debitAcc = accountMap.get(debitKey)!
      debitAcc.debit += Number(entry.amount)

      // Alacak hesabı
      const creditKey = entry.creditAccountId
      if (!accountMap.has(creditKey)) {
        accountMap.set(creditKey, {
          code: entry.creditAccount.code,
          name: entry.creditAccount.name,
          debit: 0,
          credit: 0,
        })
      }
      const creditAcc = accountMap.get(creditKey)!
      creditAcc.credit += Number(entry.amount)
    })

    const summary = Array.from(accountMap.values()).map((acc) => ({
      accountCode: acc.code,
      accountName: acc.name,
      debitTotal: acc.debit,
      creditTotal: acc.credit,
      balance: acc.debit - acc.credit,
    }))

    summary.sort((a, b) => a.accountCode.localeCompare(b.accountCode))

    return NextResponse.json(summary)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error fetching kebir summary:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

