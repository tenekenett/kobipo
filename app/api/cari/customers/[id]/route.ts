import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { supplierHasBusinessReferences } from "@/lib/cari/dual-role"
import { getCustomerDeletability } from "@/lib/cari/archive-guard"
import { CHECK_NOTE_NON_SETTLING, checkNoteSignedCredit } from "@/lib/cari/check-credit"
import { resolveCariId } from "@/lib/cari/resolve-cari"


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
    resolvedParams.id = await resolveCariId("customer", resolvedParams.id, new URL(request.url).searchParams.get("companyId"))

    // Hafif yol: silme diyaloğu yalnızca silinebilirliği ister. Tüm ekstreyi
    // (bakiye + faturalar + işlemler + çek/senet + yürüyen bakiye) hesaplamadan
    // sadece deletability döner — liste sayfasındaki "Sil" tıklamasını hızlandırır.
    if (new URL(request.url).searchParams.get("only") === "deletability") {
      const lite = await prisma.customer.findUnique({
        where: { id: resolvedParams.id },
        select: { id: true, companyId: true },
      })
      if (!lite) {
        return NextResponse.json({ error: "Customer not found" }, { status: 404 })
      }
      await ensureCompanyAccess(lite.companyId)
      const deletability = await getCustomerDeletability(lite.id)
      return NextResponse.json({ deletability })
    }

    const customer = await prisma.customer.findUnique({
      where: { id: resolvedParams.id },
      include: {
        branches: {
          orderBy: { createdAt: "asc" },
        },
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
          where: { status: { not: "CANCELLED" } },
          orderBy: { date: "desc" },
          take: 10,
          include: {
            payments: {
              select: { amount: true },
            },
          },
        },
        transactions: {
          orderBy: { date: "desc" },
          take: 10,
          include: {
            account: true,
          },
        },
      },
    })

    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 })
    }

    await ensureCompanyAccess(customer.companyId)

    // Calculate balance using database aggregation to avoid N+1 queries
    const [invoiceAggregate, paymentAggregate, incomeTransactionAggregate, expenseTransactionAggregate] = await Promise.all([
      prisma.invoice.aggregate({
        where: { customerId: customer.id, type: "SALES", status: { not: "CANCELLED" } },
        _sum: { totalAmount: true },
      }),
      prisma.invoicePayment.aggregate({
        // Bir Transaction'a bağlı ödemeler bakiyeye işlemin kendisi üzerinden
        // (− gelir) yansıdığı için burada hariç tutulur (çift sayımı önler).
        where: {
          transactionId: null,
          invoice: { customerId: customer.id, type: "SALES", status: { not: "CANCELLED" } },
        },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { customerId: customer.id, type: "INCOME" },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { customerId: customer.id, type: "EXPENSE" },
        _sum: { amount: true },
      }),
    ])

    // Calculate balance: unpaid invoices + expenses - income + opening balance
    let balance = Number(invoiceAggregate._sum.totalAmount || 0) - Number(paymentAggregate._sum.amount || 0) + Number(expenseTransactionAggregate._sum.amount || 0) - Number(incomeTransactionAggregate._sum.amount || 0)
    balance += customer.openingBalanceType === "CREDIT"
      ? -Number(customer.openingBalanceAmount || 0)
      : Number(customer.openingBalanceAmount || 0)

    // Get all invoices and transactions for display (with payments included to avoid N+1)
    const [allInvoices, allTransactions, allChecks, allNotes] = await Promise.all([
      prisma.invoice.findMany({
        where: { customerId: customer.id, status: { not: "CANCELLED" } },
        include: {
          payments: {
            select: { amount: true },
          },
        },
        orderBy: { date: "asc" }, // For chronological order in formatted transactions
      }),
      prisma.transaction.findMany({
        where: { customerId: customer.id },
        include: {
          account: true,
        },
        orderBy: { date: "asc" },
      }),
      // Müşteriden alınan çek/senet (iade/protesto hariç) alacağı kapatır.
      prisma.check.findMany({
        where: { customerId: customer.id, status: { notIn: [...CHECK_NOTE_NON_SETTLING] } },
        orderBy: { issueDate: "asc" },
      }),
      prisma.promissoryNote.findMany({
        where: { customerId: customer.id, status: { notIn: [...CHECK_NOTE_NON_SETTLING] } },
        orderBy: { issueDate: "asc" },
      }),
    ])

    // Çek/senet net etkisi (yön + iade/protesto hariç) bakiyeyi azaltır/artırır.
    // Müşteride alınan çek alacağı azaltır; verilen çek (iade) artırır.
    const checkNoteCredit =
      allChecks.reduce((s, c) => s + checkNoteSignedCredit("customer", c.direction, Number(c.amount)), 0) +
      allNotes.reduce((s, n) => s + checkNoteSignedCredit("customer", n.direction, Number(n.amount)), 0)
    balance -= checkNoteCredit

    // Format transactions for display
    const openingAmount = Number(customer.openingBalanceAmount || 0)
    const openingType = customer.openingBalanceType === "CREDIT" ? "CREDIT" : "DEBIT"
    const openingTransaction =
      openingAmount > 0
        ? [
            {
              id: `opening-${customer.id}`,
              date: customer.createdAt.toISOString(),
              type: "OPENING",
              description: `Açılış Bakiyesi (${openingType === "CREDIT" ? "Alacak" : "Borç"})`,
              debit: openingType === "DEBIT" ? openingAmount : 0,
              credit: openingType === "CREDIT" ? openingAmount : 0,
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
        debit: inv.type === "SALES" ? Number(inv.totalAmount) : 0,
        credit: 0,
        balance: 0,
        invoiceNo: inv.invoiceNo,
      })),
      ...allTransactions.map((trx) => ({
        id: trx.id,
        date: trx.date.toISOString(),
        type: trx.type === "INCOME" ? "PAYMENT" : "EXPENSE",
        description: trx.description || `${trx.type} - ${trx.account?.name || ""}`,
        // EXPENSE (ör. müşteri adına masraf) cariyi borçlandırır → Borç sütunu.
        // Bakiye formülü de EXPENSE'i +olarak sayar (yukarı, satır ~104); burada
        // atlanırsa ekstrenin yürüyen bakiyesi üstteki Bakiye kartıyla tutmaz.
        debit: trx.type === "EXPENSE" ? Number(trx.amount) : 0,
        credit: trx.type === "INCOME" ? Number(trx.amount) : 0,
        balance: 0,
        invoiceNo: null,
      })),
      // Alınan çek alacağı azaltır → Alacak sütunu; verilen çek (iade) artırır → Borç.
      ...allChecks.map((ch) => {
        const given = ch.direction === "GIVEN"
        return {
          id: ch.id,
          date: ch.issueDate.toISOString(),
          type: "CHECK",
          description: `Çek ${ch.checkNo}${ch.bankName ? ` - ${ch.bankName}` : ""}`,
          debit: given ? Number(ch.amount) : 0,
          credit: given ? 0 : Number(ch.amount),
          balance: 0,
          invoiceNo: null,
        }
      }),
      ...allNotes.map((nt) => {
        const given = nt.direction === "GIVEN"
        return {
          id: nt.id,
          date: nt.issueDate.toISOString(),
          type: "NOTE",
          description: `Senet ${nt.noteNo}`,
          debit: given ? Number(nt.amount) : 0,
          credit: given ? 0 : Number(nt.amount),
          balance: 0,
          invoiceNo: null,
        }
      }),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    // Calculate running balance
    let runningBalance = 0
    formattedTransactions.forEach((tx) => {
      runningBalance += tx.debit - tx.credit
      tx.balance = runningBalance
    })

    const deletability = await getCustomerDeletability(customer.id)

    return NextResponse.json({
      ...customer,
      balance,
      totalDebit: formattedTransactions.reduce((sum, t) => sum + t.debit, 0),
      totalCredit: formattedTransactions.reduce((sum, t) => sum + t.credit, 0),
      invoiceCount: allInvoices.length,
      transactions: formattedTransactions,
      deletability,
    })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching customer:", error)
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
    resolvedParams.id = await resolveCariId("customer", resolvedParams.id, new URL(request.url).searchParams.get("companyId"))
    const customer = await prisma.customer.findUnique({
      where: { id: resolvedParams.id },
    })

    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 })
    }

    await ensureCompanyAccess(customer.companyId)

    const body = await request.json()
    const {
      code,
      name,
      taxNumber,
      taxOffice,
      address,
      city,
      district,
      phone,
      email,
      contactPerson,
      eInvoiceAlias,
      paymentDueDays,
      openingBalanceAmount,
      openingBalanceType,
      riskLimit,
      bankInfo,
      note,
      branches,
      classification1Id,
      classification2Id,
      authorizedUserId,
      isAlsoSupplier,
    } = body

    const paymentDueDaysVal = parsePaymentDueDays(paymentDueDays)
    const openingBalanceAmountVal =
      openingBalanceAmount !== undefined && openingBalanceAmount !== "" && openingBalanceAmount !== null
        ? Number(openingBalanceAmount)
        : 0
    const riskLimitVal = parseDecimalOrNull(riskLimit)
    const openingBalanceTypeVal = parseOpeningBalanceType(openingBalanceType)
    const parsedBranches = Array.isArray(branches)
      ? branches
          .map((branch) => ({
            name: String(branch?.name || "").trim(),
            address: branch?.address ? String(branch.address).trim() : null,
          }))
          .filter((branch) => branch.name.length > 0)
      : null

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.customer.findUnique({
        where: { id: resolvedParams.id },
      })
      if (!current) throw new Error("Customer not found")

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
        district: district !== undefined ? district : current.district,
        phone: phone !== undefined ? phone : current.phone,
        email: email !== undefined ? email : current.email,
        contactPerson: contactPerson !== undefined ? contactPerson : current.contactPerson,
        eInvoiceAlias: eInvoiceAlias !== undefined ? eInvoiceAlias : current.eInvoiceAlias,
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

      let linkedSupplierId = current.linkedSupplierId
      let nextIsAlsoSupplier =
        isAlsoSupplier !== undefined ? Boolean(isAlsoSupplier) : current.isAlsoSupplier

      if (isAlsoSupplier === false && current.linkedSupplierId) {
        const sid = current.linkedSupplierId
        await tx.customer.update({
          where: { id: current.id },
          data: { linkedSupplierId: null, isAlsoSupplier: false },
        })
        linkedSupplierId = null
        nextIsAlsoSupplier = false
        const hasRefs = await supplierHasBusinessReferences(tx, sid)
        if (hasRefs) {
          await tx.supplier.update({
            where: { id: sid },
            data: { linkedCustomerId: null, isAlsoCustomer: false },
          })
        } else {
          await tx.supplier.delete({ where: { id: sid } })
        }
      }

      /* nextIsAlsoSupplier: bayrak true ama link yoksa (yetim) tedarikçi oluştur — sadece === true değil */
      if (nextIsAlsoSupplier && !linkedSupplierId) {
        const linkedSupplier = await tx.supplier.create({
          data: {
            companyId: current.companyId,
            code: merged.code,
            name: merged.name,
            taxNumber: merged.taxNumber,
            taxOffice: merged.taxOffice,
            address: merged.address,
            city: merged.city,
            district: merged.district,
            phone: merged.phone,
            email: merged.email,
            contactPerson: merged.contactPerson,
            eInvoiceAlias: merged.eInvoiceAlias,
            paymentDueDays: merged.paymentDueDays,
            openingBalanceAmount: merged.openingBalanceAmount,
            openingBalanceType: merged.openingBalanceType,
            isAlsoCustomer: true,
            linkedCustomerId: current.id,
          },
        })
        linkedSupplierId = linkedSupplier.id
        nextIsAlsoSupplier = true
      }

      const saved = await tx.customer.update({
        where: { id: resolvedParams.id },
        data: {
          code: merged.code,
          name: merged.name,
          taxNumber: merged.taxNumber,
          taxOffice: merged.taxOffice,
          address: merged.address,
          city: merged.city,
          district: merged.district,
          phone: merged.phone,
          email: merged.email,
          contactPerson: merged.contactPerson,
          eInvoiceAlias: merged.eInvoiceAlias,
          paymentDueDays: merged.paymentDueDays,
          openingBalanceAmount: merged.openingBalanceAmount,
          openingBalanceType: merged.openingBalanceType,
          riskLimit: merged.riskLimit,
          bankInfo: merged.bankInfo,
          note: merged.note,
          classification1Id: merged.classification1Id,
          classification2Id: merged.classification2Id,
          authorizedUserId: merged.authorizedUserId,
          isAlsoSupplier: nextIsAlsoSupplier,
          linkedSupplierId,
        },
      })

      if (parsedBranches !== null) {
        await tx.customerBranch.deleteMany({
          where: { customerId: saved.id },
        })
        if (parsedBranches.length > 0) {
          await tx.customerBranch.createMany({
            data: parsedBranches.map((branch) => ({
              customerId: saved.id,
              name: branch.name,
              address: branch.address,
            })),
          })
        }
      }

      if (saved.linkedSupplierId) {
        await tx.supplier.update({
          where: { id: saved.linkedSupplierId },
          data: {
            code: saved.code,
            name: saved.name,
            taxNumber: saved.taxNumber,
            taxOffice: saved.taxOffice,
            address: saved.address,
            city: saved.city,
            district: saved.district,
            phone: saved.phone,
            email: saved.email,
            contactPerson: saved.contactPerson,
            eInvoiceAlias: saved.eInvoiceAlias,
            paymentDueDays: saved.paymentDueDays,
            openingBalanceAmount: saved.openingBalanceAmount,
            openingBalanceType: saved.openingBalanceType,
            riskLimit: saved.riskLimit,
            bankInfo: saved.bankInfo,
            note: saved.note,
            classification1Id: saved.classification1Id,
            classification2Id: saved.classification2Id,
            authorizedUserId: saved.authorizedUserId,
            isAlsoCustomer: true,
            linkedCustomerId: saved.id,
          },
        })
      }

      return saved
    })

    return NextResponse.json(updated)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error updating customer:", error)
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
    resolvedParams.id = await resolveCariId("customer", resolvedParams.id, new URL(request.url).searchParams.get("companyId"))
    const customer = await prisma.customer.findUnique({
      where: { id: resolvedParams.id },
    })

    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 })
    }

    await ensureCompanyAccess(customer.companyId)

    // Silmeden önce kontrol: yalnızca tamamen temiz (bakiyesiz, açık faturasız,
    // geçmişsiz) kayıt silinebilir. Aksi halde sebepleri ve arşivlenebilir olup
    // olmadığını döndür ki istemci doğru diyaloğu göstersin.
    const deletability = await getCustomerDeletability(customer.id)
    if (!deletability.canDelete) {
      return NextResponse.json(
        {
          error: "Kayıt silinemiyor.",
          code: "CANNOT_DELETE",
          canArchive: deletability.canArchive,
          reasons: deletability.deleteBlockReasons,
        },
        { status: 409 },
      )
    }

    await prisma.customer.delete({
      where: { id: resolvedParams.id },
    })

    return NextResponse.json({ message: "Customer deleted" })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error deleting customer:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

// Arşivle / arşivden çıkar. Body: { action: "archive" | "unarchive" }
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    resolvedParams.id = await resolveCariId("customer", resolvedParams.id, new URL(request.url).searchParams.get("companyId"))
    const customer = await prisma.customer.findUnique({
      where: { id: resolvedParams.id },
    })

    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 })
    }

    await ensureCompanyAccess(customer.companyId)

    const body = await request.json().catch(() => ({}))
    const action = body?.action === "unarchive" ? "unarchive" : "archive"

    if (action === "archive") {
      const deletability = await getCustomerDeletability(customer.id)
      if (!deletability.canArchive) {
        return NextResponse.json(
          {
            error: "Kayıt arşivlenemiyor.",
            code: "CANNOT_ARCHIVE",
            reasons: deletability.archiveBlockReasons,
          },
          { status: 409 },
        )
      }
    }

    const updated = await prisma.customer.update({
      where: { id: resolvedParams.id },
      data: { archivedAt: action === "archive" ? new Date() : null },
    })

    return NextResponse.json({
      message: action === "archive" ? "Customer archived" : "Customer unarchived",
      archivedAt: updated.archivedAt,
    })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error archiving customer:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

