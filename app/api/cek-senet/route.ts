import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { Decimal } from "@prisma/client/runtime/library"

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    const type = searchParams.get("type") // CHECK or PROMISSORY_NOTE
    const status = searchParams.get("status")

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    if (type === "CHECK") {
      const where: any = { companyId }
      if (status) {
        where.status = status
      }

      const checks = await prisma.check.findMany({
        where,
        include: {
          customer: {
            select: {
              id: true,
              name: true,
            },
          },
          supplier: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { dueDate: "asc" },
      })

      return NextResponse.json(checks)
    } else if (type === "PROMISSORY_NOTE") {
      const where: any = { companyId }
      if (status) {
        where.status = status
      }

      const notes = await prisma.promissoryNote.findMany({
        where,
        include: {
          customer: {
            select: {
              id: true,
              name: true,
            },
          },
          supplier: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { dueDate: "asc" },
      })

      return NextResponse.json(notes)
    } else {
      return NextResponse.json(
        { error: "type must be CHECK or PROMISSORY_NOTE" },
        { status: 400 }
      )
    }
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching checks/notes:", error)
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
    const { type, ...data } = body

    if (!type || (type !== "CHECK" && type !== "PROMISSORY_NOTE")) {
      return NextResponse.json(
        { error: "type must be CHECK or PROMISSORY_NOTE" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(data.companyId)

    if (type === "CHECK") {
      const {
        companyId,
        checkNo,
        bankName,
        branchName,
        accountNo,
        amount,
        issueDate,
        dueDate,
        status,
        direction,
        customerId,
        supplierId,
        invoiceId,
        notes,
      } = data

      if (!companyId || !checkNo || !bankName || !amount || !issueDate || !dueDate) {
        return NextResponse.json(
          { error: "Required fields missing for check" },
          { status: 400 }
        )
      }

      const check = await prisma.check.create({
        data: {
          companyId,
          checkNo,
          bankName,
          branchName: branchName || null,
          accountNo: accountNo || null,
          amount: new Decimal(amount),
          issueDate: new Date(issueDate),
          dueDate: new Date(dueDate),
          status: status || "PORTFÖYDE",
          direction: direction || null,
          customerId: customerId || null,
          supplierId: supplierId || null,
          invoiceId: invoiceId || null,
          notes: notes || null,
          createdBy: user.id,
        },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
            },
          },
          supplier: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      })

      return NextResponse.json(check, { status: 201 })
    } else {
      const {
        companyId,
        noteNo,
        amount,
        issueDate,
        dueDate,
        status,
        direction,
        customerId,
        supplierId,
        invoiceId,
        notes,
      } = data

      if (!companyId || !noteNo || !amount || !issueDate || !dueDate) {
        return NextResponse.json(
          { error: "Required fields missing for promissory note" },
          { status: 400 }
        )
      }

      const note = await prisma.promissoryNote.create({
        data: {
          companyId,
          noteNo,
          amount: new Decimal(amount),
          issueDate: new Date(issueDate),
          dueDate: new Date(dueDate),
          status: status || "PORTFÖYDE",
          direction: direction || null,
          customerId: customerId || null,
          supplierId: supplierId || null,
          invoiceId: invoiceId || null,
          notes: notes || null,
          createdBy: user.id,
        },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
            },
          },
          supplier: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      })

      return NextResponse.json(note, { status: 201 })
    }
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error creating check/note:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

