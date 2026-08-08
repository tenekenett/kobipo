import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { Decimal } from "@prisma/client/runtime/library"
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
      orderBy: { date: "desc" },
    })

    return NextResponse.json(entries)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error fetching entries:", error)
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
    body.companyId = await resolveCompanyId(body.companyId)
    const {
      companyId,
      entryNo,
      date,
      description,
      debitAccountId,
      creditAccountId,
      amount,
      reference,
      referenceType,
    } = body

    if (!companyId || !entryNo || !debitAccountId || !creditAccountId || !amount) {
      return NextResponse.json(
        { error: "Required fields missing" },
        { status: 400 }
      )
    }

    await ensureCompanyWrite(companyId)

    const entry = await prisma.accountingEntry.create({
      data: {
        companyId,
        entryNo,
        date: date ? new Date(date) : new Date(),
        description: description || null,
        debitAccountId,
        creditAccountId,
        amount: new Decimal(amount),
        reference: reference || null,
        referenceType: referenceType || null,
        createdBy: user.id,
      },
      include: {
        debitAccount: true,
        creditAccount: true,
      },
    })

    return NextResponse.json(entry, { status: 201 })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error creating entry:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

