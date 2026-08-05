import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { customerHasBusinessReferences } from "@/lib/cari/dual-role"
import { getSupplierDeletability } from "@/lib/cari/archive-guard"
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
    resolvedParams.id = await resolveCariId("supplier", resolvedParams.id, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))

    // Hafif yol: silme diyaloğu yalnızca silinebilirliği ister. Tüm ekstreyi
    // hesaplamadan sadece deletability döner — liste "Sil" tıklamasını hızlandırır.
    if (new URL(request.url).searchParams.get("only") === "deletability") {
      const lite = await prisma.supplier.findUnique({
        where: { id: resolvedParams.id },
        select: { id: true, companyId: true },
      })
      if (!lite) {
        return NextResponse.json({ error: "Supplier not found" }, { status: 404 })
      }
      await ensureCompanyAccess(lite.companyId)
      const deletability = await getSupplierDeletability(lite.id)
      return NextResponse.json({ deletability })
    }

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
          where: { status: { notIn: ["CANCELLED", "CONVERTED"] } },
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
      where: { supplierId: supplier.id, status: { notIn: ["CANCELLED", "CONVERTED"] } },
      include: {
        payments: {
          select: {
            amount: true,
            transactionId: true,
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

    // Tedarikçiye verilen çek/senet (iade/protesto hariç) borcumuzu kapatır.
    const [allChecks, allNotes, convertedReceipts] = await Promise.all([
      prisma.check.findMany({
        where: { supplierId: supplier.id, status: { notIn: [...CHECK_NOTE_NON_SETTLING] } },
        orderBy: { issueDate: "asc" },
      }),
      prisma.promissoryNote.findMany({
        where: { supplierId: supplier.id, status: { notIn: [...CHECK_NOTE_NON_SETTLING] } },
        orderBy: { issueDate: "asc" },
      }),
      // Faturaya dönüştürülmüş fişler: ekstrede bilgi amaçlı ("Fiş" olarak, hangi
      // faturaya dönüştüğü belirtilerek). Ekonomik etki artık faturada; bakiyeye
      // ETKİ ETMEZ (borç/alacak = 0) — çift sayımı önler.
      prisma.invoice.findMany({
        where: { supplierId: supplier.id, isReceipt: true, status: "CONVERTED" },
        include: { convertedInvoice: { select: { id: true, invoiceNo: true, eDocumentNo: true } } },
        orderBy: { date: "asc" },
      }),
    ])
    // Tedarikçide verilen çek borcu azaltır; alınan çek (iade) artırır.
    const checkNoteCredit =
      allChecks.reduce((s, c) => s + checkNoteSignedCredit("supplier", c.direction, Number(c.amount)), 0) +
      allNotes.reduce((s, n) => s + checkNoteSignedCredit("supplier", n.direction, Number(n.amount)), 0)

    // Calculate balance (unpaid invoices - payments). Bir Transaction'a bağlı
    // ödemeler bakiyeye işlem üzerinden yansıdığından burada hariç tutulur.
    let balance = 0
    allInvoices.forEach((inv) => {
      // MAHSUP: aynı cari hem tedarikçi hem müşteri olabilir. Bu tedarikçiye kayıtlı
      // bir SATIŞ faturası onun bize borcudur ve bizim ona olan borcumuzu azaltır.
      // Önceden yalnız PURCHASE sayılıyordu; satış faturası ekstrede GÖRÜNÜP bakiyeye
      // hiç girmiyordu (müşteri tarafındaki alış faturasıyla aynı hata).
      if (inv.type !== "PURCHASE" && inv.type !== "SALES") return
      const totalPaid = inv.payments.reduce(
        (sum, p) => sum + (p.transactionId ? 0 : Number(p.amount)),
        0,
      )
      const net = Number(inv.totalAmount) - totalPaid
      balance += inv.type === "PURCHASE" ? net : -net
    })

    // Tedarikçide ödeme (EXPENSE → kasadan çıkan) borcu AZALTIR; tahsilat
    // (INCOME → tedarikçiden gelen, ör. iade) borcu ARTIRIR. Bu, müşteri
    // formülünün simetriğidir; işaretler tedarikçide terstir.
    transactions.forEach((trx) => {
      if (trx.type === "EXPENSE") {
        balance -= Number(trx.amount)
      } else if (trx.type === "INCOME") {
        balance += Number(trx.amount)
      }
    })
    // Tedarikçide işaretler müşterinin aynasıdır: pozitif bakiye = biz ona borçluyuz.
    // Açılış da aynalanmalı → CREDIT (Alacak, biz ona borçluyuz) bakiyeyi ARTIRIR,
    // DEBIT (Borç, avans/o bize borçlu) AZALTIR. Böylece açılış, alış faturasıyla
    // aynı yönde davranır (ödenmemiş alış faturası da +tutar ekler).
    balance +=
      supplier.openingBalanceType === "CREDIT"
        ? Number(supplier.openingBalanceAmount)
        : -Number(supplier.openingBalanceAmount)

    // Tedarikçiye verilen çek/senet ödeme gibidir → borcumuzu (pozitif bakiye) azaltır.
    balance -= checkNoteCredit

    // Format transactions for display
    const openingAmount = Number(supplier.openingBalanceAmount || 0)
    const openingType = supplier.openingBalanceType === "CREDIT" ? "CREDIT" : "DEBIT"
    const openingTransaction =
      openingAmount > 0
        ? [
            {
              id: `opening-${supplier.id}`,
              date: supplier.createdAt.toISOString(),
              createdAt: supplier.createdAt.toISOString(),
              type: "OPENING",
              description: `Açılış Bakiyesi (${openingType === "CREDIT" ? "Alacak" : "Borç"})`,
              // Aynalı işaret (yürüyen bakiye credit−debit ile hesaplanır):
              // CREDIT (Alacak) → Alacak sütunu (+), DEBIT (Borç/avans) → Borç sütunu (−).
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
        createdAt: inv.createdAt.toISOString(),
        type: "INVOICE",
        // Fiş, gayriresmî belge; ekstrede fatura ile aynı satırda ama "Fiş" etiketli.
        isReceipt: inv.isReceipt,
        // Cari ekstrede resmi GİB belge no'yu göster; yoksa iç seri numarasına düş.
        description: `${inv.isReceipt ? "Fiş" : "Fatura"} ${inv.eDocumentNo || inv.invoiceNo}`,
        debit: 0,
        credit: inv.type === "PURCHASE" ? Number(inv.totalAmount) : 0,
        balance: 0,
        invoiceNo: inv.eDocumentNo || inv.invoiceNo,
      })),
      // Dönüştürülmüş fişler: bilgi satırı — bakiyeye etki etmez (borç/alacak = 0).
      ...convertedReceipts.map((inv) => ({
        id: inv.id,
        date: inv.date.toISOString(),
        createdAt: inv.createdAt.toISOString(),
        type: "INVOICE",
        isReceipt: true,
        converted: true,
        convertedToId: inv.convertedInvoice?.id ?? null,
        convertedToNo: inv.convertedInvoice
          ? inv.convertedInvoice.eDocumentNo || inv.convertedInvoice.invoiceNo
          : null,
        receiptAmount: Number(inv.totalAmount),
        description: `Fiş ${inv.eDocumentNo || inv.invoiceNo}`,
        debit: 0,
        credit: 0,
        balance: 0,
        invoiceNo: inv.eDocumentNo || inv.invoiceNo,
      })),
      ...transactions.map((trx) => ({
        id: trx.id,
        date: trx.date.toISOString(),
        createdAt: trx.createdAt.toISOString(),
        type: trx.type === "EXPENSE" ? "PAYMENT" : "INCOME",
        // Açıklama boşsa işlem türüne göre insanca etiket: ödeme/tahsilat.
        description:
          trx.description ||
          (trx.type === "EXPENSE"
            ? "Ödeme"
            : trx.type === "INCOME"
              ? "Tahsilat"
              : `${trx.type} - ${trx.account?.name || ""}`),
        // Ekstrede yürüyen bakiye `credit - debit` ile hesaplanır: ödeme (EXPENSE)
        // borç sütunu → borcu azaltır, tahsilat (INCOME) alacak sütunu → artırır.
        debit: trx.type === "EXPENSE" ? Number(trx.amount) : 0,
        credit: trx.type === "INCOME" ? Number(trx.amount) : 0,
        balance: 0,
        invoiceNo: null,
      })),
      // Verilen çek borcu azaltır → Borç sütunu; alınan çek (iade) artırır → Alacak.
      ...allChecks.map((ch) => {
        const received = ch.direction === "RECEIVED"
        return {
          id: ch.id,
          date: ch.issueDate.toISOString(),
          createdAt: ch.createdAt.toISOString(),
          type: "CHECK",
          description: `Çek ${ch.checkNo}${ch.bankName ? ` - ${ch.bankName}` : ""}`,
          debit: received ? 0 : Number(ch.amount),
          credit: received ? Number(ch.amount) : 0,
          balance: 0,
          invoiceNo: null,
        }
      }),
      ...allNotes.map((nt) => {
        const received = nt.direction === "RECEIVED"
        return {
          id: nt.id,
          date: nt.issueDate.toISOString(),
          createdAt: nt.createdAt.toISOString(),
          type: "NOTE",
          description: `Senet ${nt.noteNo}`,
          debit: received ? 0 : Number(nt.amount),
          credit: received ? Number(nt.amount) : 0,
          balance: 0,
          invoiceNo: null,
        }
      }),
      // İş tarihine göre kronolojik; aynı gün içinde kayıt saatine (createdAt) göre
      // dengele ki yürüyen bakiye kararlı olsun ve saatler doğru sırada görünsün.
    ].sort((a, b) => {
      const byDate = new Date(a.date).getTime() - new Date(b.date).getTime()
      return byDate !== 0
        ? byDate
        : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })

    // Calculate running balance
    let runningBalance = 0
    formattedTransactions.forEach((tx) => {
      runningBalance += tx.credit - tx.debit
      tx.balance = runningBalance
    })

    const deletability = await getSupplierDeletability(supplier.id)

    return NextResponse.json({
      ...supplier,
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
    resolvedParams.id = await resolveCariId("supplier", resolvedParams.id, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))
    const supplier = await prisma.supplier.findUnique({
      where: { id: resolvedParams.id },
    })

    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 })
    }

    await ensureCompanyWrite(supplier.companyId)

    const body = await request.json()
    const {
      code,
      name,
      nickname,
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
        // Gönderilmediyse dokunma; boş gönderildiyse takma adı temizle.
        nickname:
          nickname !== undefined
            ? (typeof nickname === "string" && nickname.trim() ? nickname.trim() : null)
            : current.nickname,
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
            nickname: merged.nickname,
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
          nickname: merged.nickname,
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
            nickname: saved.nickname,
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
    resolvedParams.id = await resolveCariId("supplier", resolvedParams.id, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))
    const supplier = await prisma.supplier.findUnique({
      where: { id: resolvedParams.id },
    })

    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 })
    }

    await ensureCompanyWrite(supplier.companyId)

    const deletability = await getSupplierDeletability(supplier.id)
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
    resolvedParams.id = await resolveCariId("supplier", resolvedParams.id, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))
    const supplier = await prisma.supplier.findUnique({
      where: { id: resolvedParams.id },
    })

    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 })
    }

    await ensureCompanyWrite(supplier.companyId)

    const body = await request.json().catch(() => ({}))
    const action = body?.action === "unarchive" ? "unarchive" : "archive"

    if (action === "archive") {
      const deletability = await getSupplierDeletability(supplier.id)
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

    const updated = await prisma.supplier.update({
      where: { id: resolvedParams.id },
      data: { archivedAt: action === "archive" ? new Date() : null },
    })

    return NextResponse.json({
      message: action === "archive" ? "Supplier archived" : "Supplier unarchived",
      archivedAt: updated.archivedAt,
    })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error archiving supplier:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

