import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { createInvoicePayment } from "@/lib/finans/create-invoice-payment"
import { sessionWriteActor } from "@/lib/api/session-actor"

export const dynamic = 'force-dynamic'

export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    const invoiceId = searchParams.get("invoiceId")

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

    if (invoiceId) {
      where.invoiceId = invoiceId
    }

    const payments = await prisma.invoicePayment.findMany({
      where,
      include: {
        invoice: {
          select: {
            id: true,
            invoiceNo: true,
            totalAmount: true,
          },
        },
        account: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
      orderBy: {
        paymentDate: "desc",
      },
    })

    return NextResponse.json(payments)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error fetching payments:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
})

export const POST = withApiErrors(async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  // İş mantığı lib/finans/create-invoice-payment.ts'te (oturumsuz çağrılabilsin diye).
  return createInvoicePayment(() => request.json(), sessionWriteActor(user.id))
})
