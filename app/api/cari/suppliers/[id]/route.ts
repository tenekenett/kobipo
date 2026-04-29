import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { customerHasBusinessReferences } from "@/lib/cari/dual-role"


export const dynamic = 'force-dynamic'
function parseOpeningBalanceType(value: unknown) {
  return String(value || "").toUpperCase() === "CREDIT" ? "CREDIT" : "DEBIT"
}

function parsePaymentDueDays(value: unknown): number | null {
  if (value === undefined) return null
  if (value === null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseDecimalOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
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
    const supplier = await prisma.supplier.findUnique({
      where: { id: resolvedParams.id },
      include: {
        classification1: {
          select: { id: true, label: true, type: true },
        },
        classification2: {
          select: { id: true, label: true, type: true },
        },
        authorizedUser: {
          select: { id: true, name: true, email: true },
        },
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

    // Get all invoices and payments
    const allInvoices = await prisma.invoice.findMany({
      where: { supplierId: supplier.id },
      include: {
        payments: {
          select: {
            amount: true,
          },
        },
      },
    })

    const transactions = await prisma.transaction.findMany({
      where: { supplierId: supplier.id },
      include: {
        account: true,
      },
    })

    // Calculate balance (unpaid invoices - payments)
    let balance = 0
    allInvoices.forEach((inv) => {
      if (inv.type === "PURCHASE") {
        const totalPaid = inv.payments.reduce((sum, p) => sum + Number(p.amount), 0)
        balance += Number(inv.totalAmount) - totalPaid
      }
    })

    transactions.forEach((trx) => {
      if (trx.type === "EXPENSE") {
        balance += Number(trx.amount)
      } else {
        balance -= Number(trx.amount)
      }
    })
    balance +=
      supplier.openingBalanceType === "CREDIT"
        ? -Number(supplier.openingBalanceAmount)
        : Number(supplier.openingBalanceAmount)

    // Format transactions for display
    const openingAmount = Number(supplier.openingBalanceAmount || 0)
    const openingType = supplier.openingBalanceType === "CREDIT" ? "CREDIT" : "DEBIT"
    const openingTransaction =
      openingAmount > 0
        ? [
            {
              id: `opening-${supplier.id}`,
              date: supplier.createdAt.toISOString(),
              type: "OPENING",
              description: `Açılış Bakiyesi (${openingType === "CREDIT" ? "Alacak" : "Borç"})`,
              debit: openingType === "CREDIT" ? openingAmount : 0,
              credit: openingType === "DEBIT" ? openingAmount : 0,
              balance: 0,
              invoiceNo: null,
            },
          ]
        : []

    const formattedTransactions = [
      ...openingTransaction,
      ...allInvoices.map((inv) => ({
        id: inv.id,
        date: inv.date.toISOString(),
        type: "INVOICE",
        description: `Fatura ${inv.invoiceNo}`,
        debit: 0,
        credit: inv.type === "PURCHASE" ? Number(inv.totalAmount) : 0,
        balance: 0,
        invoiceNo: inv.invoiceNo,
      })),
      ...transactions.map((trx) => ({
        id: trx.id,
        date: trx.date.toISOString(),
        type: trx.type === "EXPENSE" ? "PAYMENT" : "INCOME",
        description: trx.description || `${trx.type} - ${trx.account?.name || ""}`,
        debit: trx.type === "EXPENSE" ? Number(trx.amount) : 0,
        credit: 0,
        balance: 0,
        invoiceNo: null,
      })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    // Calculate running balance
    let runningBalance = 0
    formattedTransactions.forEach((tx) => {
      runningBalance += tx.credit - tx.debit
      tx.balance = runningBalance
    })

    return NextResponse.json({
      ...supplier,
      balance,
      totalDebit: formattedTransactions.reduce((sum, t) => sum + t.debit, 0),
      totalCredit: formattedTransactions.reduce((sum, t) => sum + t.credit, 0),
      invoiceCount: allInvoices.length,
      transactions: formattedTransactions,
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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    const supplier = await prisma.supplier.findUnique({
      where: { id: resolvedParams.id },
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
      paymentDueDays,
      openingBalanceAmount,
      openingBalanceType,
      riskLimit,
      bankInfo,
      note,
      classification1Id,
      classification2Id,
      authorizedUserId,
      isAlsoCustomer,
    } = body

    const paymentDueDaysVal = parsePaymentDueDays(paymentDueDays)
    const openingBalanceAmountVal =
      openingBalanceAmount !== undefined && openingBalanceAmount !== "" && openingBalanceAmount !== null
        ? Number(openingBalanceAmount)
        : 0
    const riskLimitVal = parseDecimalOrNull(riskLimit)
    const openingBalanceTypeVal = parseOpeningBalanceType(openingBalanceType)

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.supplier.findUnique({
        where: { id: resolvedParams.id },
      })
      if (!current) throw new Error("Supplier not found")

      const normalizedClassification1Id =
        classification1Id !== undefined
          ? (classification1Id ? String(classification1Id) : null)
          : current.classification1Id
      const normalizedClassification2Id =
        classification2Id !== undefined
          ? (classification2Id ? String(classification2Id) : null)
          : current.classification2Id
      const normalizedAuthorizedUserId =
        authorizedUserId !== undefined
          ? (authorizedUserId ? String(authorizedUserId) : null)
          : current.authorizedUserId

      if (normalizedClassification1Id) {
        const classification1 = await tx.companyDefinition.findFirst({
          where: {
            id: normalizedClassification1Id,
            companyId: current.companyId,
            type: "CLASS_1",
            isActive: true,
          },
          select: { id: true },
        })
        if (!classification1) throw new Error("Sınıflandırma 1 kaydı bulunamadı")
      }
      if (normalizedClassification2Id) {
        const classification2 = await tx.companyDefinition.findFirst({
          where: {
            id: normalizedClassification2Id,
            companyId: current.companyId,
            type: "CLASS_2",
            isActive: true,
          },
          select: { id: true },
        })
        if (!classification2) throw new Error("Sınıflandırma 2 kaydı bulunamadı")
      }
      if (normalizedAuthorizedUserId) {
        const member = await tx.userCompany.findFirst({
          where: { companyId: current.companyId, userId: normalizedAuthorizedUserId },
          select: { id: true },
        })
        if (!member) throw new Error("Seçilen çalışan bu firmaya ait değil")
      }

      const merged = {
        code: code !== undefined ? code : current.code,
        name: name !== undefined ? name : current.name,
        taxNumber: taxNumber !== undefined ? taxNumber : current.taxNumber,
        taxOffice: taxOffice !== undefined ? taxOffice : current.taxOffice,
        address: address !== undefined ? address : current.address,
        city: city !== undefined ? city : current.city,
        phone: phone !== undefined ? phone : current.phone,
        email: email !== undefined ? email : current.email,
        contactPerson: contactPerson !== undefined ? contactPerson : current.contactPerson,
        paymentDueDays:
          paymentDueDays !== undefined
            ? paymentDueDaysVal
            : current.paymentDueDays,
        openingBalanceAmount:
          openingBalanceAmount !== undefined
            ? (Number.isFinite(openingBalanceAmountVal) ? openingBalanceAmountVal : 0)
            : Number(current.openingBalanceAmount),
        openingBalanceType:
          openingBalanceType !== undefined
            ? openingBalanceTypeVal
            : current.openingBalanceType,
        riskLimit:
          riskLimit !== undefined
            ? riskLimitVal
            : current.riskLimit === null
              ? null
              : Number(current.riskLimit),
        bankInfo: bankInfo !== undefined ? bankInfo : current.bankInfo,
        note: note !== undefined ? note : current.note,
        classification1Id: normalizedClassification1Id,
        classification2Id: normalizedClassification2Id,
        authorizedUserId: normalizedAuthorizedUserId,
      }

      let nextIsAlsoCustomer =
        isAlsoCustomer !== undefined ? Boolean(isAlsoCustomer) : current.isAlsoCustomer

      if (isAlsoCustomer === false) {
        const linked = await tx.customer.findFirst({
          where: { linkedSupplierId: current.id },
        })
        if (linked) {
          await tx.customer.update({
            where: { id: linked.id },
            data: { linkedSupplierId: null, isAlsoSupplier: false },
          })
          nextIsAlsoCustomer = false
          const hasRefs = await customerHasBusinessReferences(tx, linked.id)
          if (hasRefs) {
            await tx.supplier.update({
              where: { id: current.id },
              data: { linkedCustomerId: null, isAlsoCustomer: false },
            })
          } else {
            await tx.customer.delete({ where: { id: linked.id } })
            await tx.supplier.update({
              where: { id: current.id },
              data: { linkedCustomerId: null, isAlsoCustomer: false },
            })
          }
        }
      }

      const stillLinkedForCreate = await tx.customer.findFirst({
        where: { linkedSupplierId: current.id },
      })
      if (nextIsAlsoCustomer && !stillLinkedForCreate) {
        const created = await tx.customer.create({
          data: {
            companyId: current.companyId,
            code: merged.code,
            name: merged.name,
            taxNumber: merged.taxNumber,
            taxOffice: merged.taxOffice,
            address: merged.address,
            city: merged.city,
            phone: merged.phone,
            email: merged.email,
            contactPerson: merged.contactPerson,
            paymentDueDays: merged.paymentDueDays,
            openingBalanceAmount: merged.openingBalanceAmount,
            openingBalanceType: merged.openingBalanceType,
            isAlsoSupplier: true,
            linkedSupplierId: current.id,
          },
        })
        await tx.supplier.update({
          where: { id: current.id },
          data: { linkedCustomerId: created.id, isAlsoCustomer: true },
        })
        nextIsAlsoCustomer = true
      }

      const saved = await tx.supplier.update({
        where: { id: resolvedParams.id },
        data: {
          code: merged.code,
          name: merged.name,
          taxNumber: merged.taxNumber,
          taxOffice: merged.taxOffice,
          address: merged.address,
          city: merged.city,
          phone: merged.phone,
          email: merged.email,
          contactPerson: merged.contactPerson,
          paymentDueDays: merged.paymentDueDays,
          openingBalanceAmount: merged.openingBalanceAmount,
          openingBalanceType: merged.openingBalanceType,
          riskLimit: merged.riskLimit,
          bankInfo: merged.bankInfo,
          note: merged.note,
          classification1Id: merged.classification1Id,
          classification2Id: merged.classification2Id,
          authorizedUserId: merged.authorizedUserId,
          isAlsoCustomer: nextIsAlsoCustomer,
        },
      })

      const mirrorCustomer = await tx.customer.findFirst({
        where: { linkedSupplierId: saved.id },
      })
      if (mirrorCustomer) {
        await tx.customer.update({
          where: { id: mirrorCustomer.id },
          data: {
            code: saved.code,
            name: saved.name,
            taxNumber: saved.taxNumber,
            taxOffice: saved.taxOffice,
            address: saved.address,
            city: saved.city,
            phone: saved.phone,
            email: saved.email,
            contactPerson: saved.contactPerson,
            paymentDueDays: saved.paymentDueDays,
            openingBalanceAmount: saved.openingBalanceAmount,
            openingBalanceType: saved.openingBalanceType,
            riskLimit: saved.riskLimit,
            bankInfo: saved.bankInfo,
            note: saved.note,
            classification1Id: saved.classification1Id,
            classification2Id: saved.classification2Id,
            authorizedUserId: saved.authorizedUserId,
            isAlsoSupplier: true,
            linkedSupplierId: saved.id,
          },
        })
        await tx.supplier.update({
          where: { id: saved.id },
          data: {
            linkedCustomerId: mirrorCustomer.id,
            isAlsoCustomer: true,
          },
        })
      }

      return tx.supplier.findUnique({ where: { id: resolvedParams.id } })
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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    const supplier = await prisma.supplier.findUnique({
      where: { id: resolvedParams.id },
    })

    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 })
    }

    await ensureCompanyAccess(supplier.companyId)

    await prisma.supplier.delete({
      where: { id: resolvedParams.id },
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

