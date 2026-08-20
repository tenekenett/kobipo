import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { accountPaymentMethodLabel } from "@/lib/finans/account-types"
import { renderMakbuzPdf } from "@/lib/pdf/documents/makbuz-document"

export const dynamic = "force-dynamic"

/**
 * Tahsilat/Ödeme makbuzu (PDF).
 *
 * Makbuz eskiden İSTEMCİDE üretiliyordu (lib/pdf/makbuz-pdf.ts, jsPDF): aynı
 * belgenin ikinci bir düzeni, ayrı font yükleme yolu ve ayrı kayma kaynağı
 * demekti. Artık tek kaynak sunucuda; yerleşim `lib/pdf/documents/makbuz-document.ts`.
 */
export const GET = withApiErrors(async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const tx = await prisma.transaction.findUnique({
      where: { id },
      include: {
        account: { select: { name: true, type: true, bankName: true } },
        customer: { select: { name: true, taxNumber: true } },
        supplier: { select: { name: true, taxNumber: true } },
        company: {
          select: { name: true, taxNumber: true, taxOffice: true, address: true, city: true, phone: true },
        },
        invoicePayments: {
          select: { amount: true, invoice: { select: { invoiceNo: true } } },
        },
      },
    })

    if (!tx) {
      return NextResponse.json({ error: "İşlem bulunamadı" }, { status: 404 })
    }

    await ensureCompanyAccess(tx.companyId)

    // Tür etiketi ekrandakiyle aynı kuralla türetilir: cariye bağlıysa
    // Tahsilat/Ödeme, değilse Gelir/Gider.
    const kind = tx.customer
      ? "Tahsilat"
      : tx.supplier
        ? "Ödeme"
        : tx.type === "INCOME"
          ? "Gelir"
          : tx.type === "EXPENSE"
            ? "Gider"
            : tx.type

    const makbuzNo = (tx.reference?.trim() || tx.id.slice(-8)).toUpperCase()

    const pdfBuffer = await renderMakbuzPdf({
      kind,
      makbuzNo,
      date: tx.date,
      amount: Number(tx.amount),
      currency: tx.currency || "TRY",
      description: tx.description,
      reference: tx.reference,
      paymentMethod: accountPaymentMethodLabel(tx.account.type),
      account: { name: tx.account.name, bankName: tx.account.bankName },
      company: tx.company || {},
      cari: tx.customer
        ? { label: "MÜŞTERİ", name: tx.customer.name, taxNumber: tx.customer.taxNumber }
        : tx.supplier
          ? { label: "TEDARİKÇİ", name: tx.supplier.name, taxNumber: tx.supplier.taxNumber }
          : null,
      invoices: tx.invoicePayments
        .filter((p) => p.invoice)
        .map((p) => ({ invoiceNo: p.invoice!.invoiceNo, amount: Number(p.amount) })),
    })

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${kind}-Makbuzu-${makbuzNo}.pdf"`,
      },
    })
  } catch (error: any) {
    if (typeof error?.message === "string" && error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error generating makbuz PDF:", error)
    return NextResponse.json({ error: "Makbuz üretilemedi" }, { status: 500 })
  }
})
