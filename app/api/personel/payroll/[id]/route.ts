import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const existing = await prisma.payrollRecord.findUnique({
    where: { id },
    include: { employee: { select: { firstName: true, lastName: true } } },
  })
  if (!existing) return NextResponse.json({ error: "Bordro bulunamadı" }, { status: 404 })
  await ensureCompanyAccess(existing.companyId)

  const body = await request.json()

  // ---- Ödeme işaretle ----
  if (body.action === "pay") {
    if (existing.status === "PAID") {
      return NextResponse.json({ error: "Bordro zaten ödenmiş" }, { status: 400 })
    }
    const paymentDate = body.paymentDate ? new Date(body.paymentDate) : new Date()
    const accountId: string | null = body.accountId || null
    const net = Number(existing.netSalary)

    const updated = await prisma.$transaction(async (tx) => {
      let transactionId: string | null = null
      // Hesap seçildiyse gider (EXPENSE) işlemi oluştur ve bakiyeyi düş.
      if (accountId) {
        const account = await tx.financialAccount.findUnique({ where: { id: accountId } })
        if (!account || account.companyId !== existing.companyId) {
          throw new Error("ACCOUNT_NOT_FOUND")
        }
        const trx = await tx.transaction.create({
          data: {
            companyId: existing.companyId,
            accountId,
            type: "EXPENSE",
            amount: net,
            currency: "TRY",
            description: `Maaş ödemesi — ${existing.employee.firstName} ${existing.employee.lastName} (${existing.periodMonth}/${existing.periodYear})`,
            date: paymentDate,
            createdBy: user.id,
          },
        })
        transactionId = trx.id
        await tx.financialAccount.update({
          where: { id: accountId },
          data: { balance: Number(account.balance) - net },
        })
      }
      return tx.payrollRecord.update({
        where: { id },
        data: { status: "PAID", paymentDate, accountId, transactionId },
        include: { employee: { select: { id: true, firstName: true, lastName: true, department: true } } },
      })
    }).catch((e) => {
      if (e?.message === "ACCOUNT_NOT_FOUND") return null
      throw e
    })

    if (!updated) return NextResponse.json({ error: "Seçilen hesap bulunamadı" }, { status: 404 })
    return NextResponse.json(updated)
  }

  // ---- Alan güncelleme (yalnızca ödenmemişken) ----
  if (existing.status === "PAID") {
    return NextResponse.json({ error: "Ödenmiş bordro düzenlenemez" }, { status: 400 })
  }

  const parts = {
    grossSalary: body.grossSalary !== undefined ? num(body.grossSalary) : Number(existing.grossSalary),
    bonus: body.bonus !== undefined ? num(body.bonus) : Number(existing.bonus),
    advance: body.advance !== undefined ? num(body.advance) : Number(existing.advance),
    sgkDeduction: body.sgkDeduction !== undefined ? num(body.sgkDeduction) : Number(existing.sgkDeduction),
    taxDeduction: body.taxDeduction !== undefined ? num(body.taxDeduction) : Number(existing.taxDeduction),
    otherDeduction: body.otherDeduction !== undefined ? num(body.otherDeduction) : Number(existing.otherDeduction),
  }
  const netSalary = parts.grossSalary + parts.bonus - parts.advance - parts.sgkDeduction - parts.taxDeduction - parts.otherDeduction

  const updated = await prisma.payrollRecord.update({
    where: { id },
    data: {
      ...parts,
      netSalary,
      notes: body.notes !== undefined ? body.notes || null : existing.notes,
    },
    include: { employee: { select: { id: true, firstName: true, lastName: true, department: true } } },
  })
  return NextResponse.json(updated)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const existing = await prisma.payrollRecord.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Bordro bulunamadı" }, { status: 404 })
  await ensureCompanyAccess(existing.companyId)

  if (existing.status === "PAID") {
    return NextResponse.json({ error: "Ödenmiş bordro silinemez" }, { status: 400 })
  }

  await prisma.payrollRecord.delete({ where: { id } })
  return NextResponse.json({ message: "Bordro silindi" })
}
