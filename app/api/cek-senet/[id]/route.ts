import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { Decimal } from "@prisma/client/runtime/library"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = 'force-dynamic'

/**
 * Çekin/senedin kapattığı fatura. Şemada ilişki YOK (`invoiceId` düz string), bu
 * yüzden `include` ile gelmez; detay ekranı faturaya link verebilsin diye ayrıca
 * okunur.
 */
async function linkedInvoice(invoiceId: string | null) {
  if (!invoiceId) return null
  return prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, invoiceNo: true, eDocumentNo: true },
  })
}

export const GET = withApiErrors(async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type") // CHECK or PROMISSORY_NOTE

    if (!type || (type !== "CHECK" && type !== "PROMISSORY_NOTE")) {
      return NextResponse.json(
        { error: "type must be CHECK or PROMISSORY_NOTE" },
        { status: 400 }
      )
    }

    if (type === "CHECK") {
      const check = await prisma.check.findUnique({
        where: { id: resolvedParams.id },
        include: {
          customer: true,
          supplier: true,
        },
      })

      if (!check) {
        return NextResponse.json(
          { error: "Check not found" },
          { status: 404 }
        )
      }

      await ensureCompanyAccess(check.companyId)

      return NextResponse.json({ ...check, invoice: await linkedInvoice(check.invoiceId) })
    } else {
      const note = await prisma.promissoryNote.findUnique({
        where: { id: resolvedParams.id },
        include: {
          customer: true,
          supplier: true,
        },
      })

      if (!note) {
        return NextResponse.json(
          { error: "Promissory note not found" },
          { status: 404 }
        )
      }

      await ensureCompanyAccess(note.companyId)

      return NextResponse.json({ ...note, invoice: await linkedInvoice(note.invoiceId) })
    }
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error fetching check/note:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
})

export const PUT = withApiErrors(async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    const body = await request.json()
    const { type, ...data } = body

    if (!type || (type !== "CHECK" && type !== "PROMISSORY_NOTE")) {
      return NextResponse.json(
        { error: "type must be CHECK or PROMISSORY_NOTE" },
        { status: 400 }
      )
    }

    if (type === "CHECK") {
      const check = await prisma.check.findUnique({
        where: { id: resolvedParams.id },
      })

      if (!check) {
        return NextResponse.json(
          { error: "Check not found" },
          { status: 404 }
        )
      }

      await ensureCompanyWrite(check.companyId)

      const updateData: any = {}
      if (data.checkNo !== undefined) updateData.checkNo = data.checkNo
      if (data.bankName !== undefined) updateData.bankName = data.bankName
      if (data.branchName !== undefined) updateData.branchName = data.branchName
      if (data.accountNo !== undefined) updateData.accountNo = data.accountNo
      if (data.amount !== undefined) updateData.amount = new Decimal(data.amount)
      if (data.issueDate !== undefined) updateData.issueDate = new Date(data.issueDate)
      if (data.dueDate !== undefined) updateData.dueDate = new Date(data.dueDate)
      if (data.status !== undefined) updateData.status = data.status
      if (data.direction !== undefined) updateData.direction = data.direction || null
      if (data.customerId !== undefined) updateData.customerId = data.customerId || null
      if (data.supplierId !== undefined) updateData.supplierId = data.supplierId || null
      if (data.invoiceId !== undefined) updateData.invoiceId = data.invoiceId || null
      if (data.notes !== undefined) updateData.notes = data.notes || null

      const updated = await prisma.check.update({
        where: { id: resolvedParams.id },
        data: updateData,
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

      return NextResponse.json(updated)
    } else {
      const note = await prisma.promissoryNote.findUnique({
        where: { id: resolvedParams.id },
      })

      if (!note) {
        return NextResponse.json(
          { error: "Promissory note not found" },
          { status: 404 }
        )
      }

      await ensureCompanyWrite(note.companyId)

      const updateData: any = {}
      if (data.noteNo !== undefined) updateData.noteNo = data.noteNo
      if (data.amount !== undefined) updateData.amount = new Decimal(data.amount)
      if (data.issueDate !== undefined) updateData.issueDate = new Date(data.issueDate)
      if (data.dueDate !== undefined) updateData.dueDate = new Date(data.dueDate)
      if (data.status !== undefined) updateData.status = data.status
      if (data.direction !== undefined) updateData.direction = data.direction || null
      if (data.customerId !== undefined) updateData.customerId = data.customerId || null
      if (data.supplierId !== undefined) updateData.supplierId = data.supplierId || null
      if (data.invoiceId !== undefined) updateData.invoiceId = data.invoiceId || null
      if (data.notes !== undefined) updateData.notes = data.notes || null

      const updated = await prisma.promissoryNote.update({
        where: { id: resolvedParams.id },
        data: updateData,
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

      return NextResponse.json(updated)
    }
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error updating check/note:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
})

export const DELETE = withApiErrors(async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type") // CHECK or PROMISSORY_NOTE

    if (!type || (type !== "CHECK" && type !== "PROMISSORY_NOTE")) {
      return NextResponse.json(
        { error: "type must be CHECK or PROMISSORY_NOTE" },
        { status: 400 }
      )
    }

    if (type === "CHECK") {
      const check = await prisma.check.findUnique({
        where: { id: resolvedParams.id },
      })

      if (!check) {
        return NextResponse.json(
          { error: "Check not found" },
          { status: 404 }
        )
      }

      await ensureCompanyWrite(check.companyId)

      await prisma.check.delete({
        where: { id: resolvedParams.id },
      })

      return NextResponse.json({ success: true })
    } else {
      const note = await prisma.promissoryNote.findUnique({
        where: { id: resolvedParams.id },
      })

      if (!note) {
        return NextResponse.json(
          { error: "Promissory note not found" },
          { status: 404 }
        )
      }

      await ensureCompanyWrite(note.companyId)

      await prisma.promissoryNote.delete({
        where: { id: resolvedParams.id },
      })

      return NextResponse.json({ success: true })
    }
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error deleting check/note:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
})

