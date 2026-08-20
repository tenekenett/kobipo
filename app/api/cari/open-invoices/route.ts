import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { resolveSlugId } from "@/lib/slug-resolve"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

// Bir carinin açık (ödenmemiş) faturalarını döndürür. Cari ekranındaki
// "Tahsilat/Ödeme Ekle" diyaloğunda tahsilatı bir faturaya bağlamak için kullanılır.
// Açık tutar = faturaTutarı − tüm InvoicePayment (bağlı + bağsız).
export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    const customerId = searchParams.get("customerId")
    const supplierId = searchParams.get("supplierId")

    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    }
    if (!customerId && !supplierId) {
      return NextResponse.json(
        { error: "customerId or supplierId is required" },
        { status: 400 },
      )
    }

    await ensureCompanyAccess(companyId)

    // Cari id'leri SEF URL'lerinden slug olarak gelebilir → gerçek cuid'e çöz,
    // aksi halde faturalar eşleşmez ve liste boş döner.
    const resolvedCustomerId = customerId
      ? await resolveSlugId("customer", customerId, companyId)
      : null
    const resolvedSupplierId = supplierId
      ? await resolveSlugId("supplier", supplierId, companyId)
      : null

    const invoices = await prisma.invoice.findMany({
      where: {
        companyId,
        status: { notIn: ["CANCELLED", "CONVERTED"] },
        ...(resolvedCustomerId
          ? { customerId: resolvedCustomerId, type: "SALES" }
          : { supplierId: resolvedSupplierId, type: "PURCHASE" }),
      },
      select: {
        id: true,
        invoiceNo: true,
        eDocumentNo: true,
        date: true,
        dueDate: true,
        totalAmount: true,
        payments: { select: { amount: true } },
      },
      orderBy: { date: "asc" },
    })

    const open = invoices
      .map((inv) => {
        const paid = inv.payments.reduce((sum, p) => sum + Number(p.amount), 0)
        const openAmount = Number(inv.totalAmount) - paid
        return {
          id: inv.id,
          // Açık faturalarda resmi GİB belge no'yu göster; yoksa iç seri numarasına düş.
          invoiceNo: inv.eDocumentNo || inv.invoiceNo,
          date: inv.date,
          dueDate: inv.dueDate,
          totalAmount: Number(inv.totalAmount),
          openAmount: Number(openAmount.toFixed(2)),
        }
      })
      .filter((inv) => inv.openAmount > 0.005)

    return NextResponse.json(open)
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error fetching open invoices:", error)
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 })
  }
})
