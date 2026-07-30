import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { resolveSlugId } from "@/lib/slug-resolve"
import { DEFAULT_RECEIPT_TEMPLATE, normalizeReceiptTemplate } from "@/lib/fis/receipt-template"

export const dynamic = "force-dynamic"

/** Ödeme yöntemi → fişte/detayda gösterilecek Türkçe etiket. */
const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: "Nakit",
  CREDIT_CARD: "Kredi Kartı",
  MEAL_CARD: "Yemek Kartı",
  BANK_TRANSFER: "Havale/EFT",
  CHECK: "Çek",
  OTHER: "Diğer",
}

/**
 * Fiş detayı (hızlı satış/alış ile kesilen gayriresmî belge).
 * Query: companyId (zorunlu). Param id hem cuid hem slug olabilir.
 *
 * Listeden farklı olarak dönüştürülmüş (CONVERTED) ve iptal (CANCELLED) fişler de
 * döner — dönüşen fişin detayına faturadan geri gelinebilmeli.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const url = new URL(request.url)
    const companyId = await resolveCompanyId(url.searchParams.get("companyId") || undefined)
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

    await ensureCompanyAccess(companyId)

    const { id: param } = await params
    const id = await resolveSlugId("invoice", param, companyId)

    const receipt = await prisma.invoice.findFirst({
      where: { id, companyId, isReceipt: true },
      include: {
        items: { orderBy: { order: "asc" } },
        customer: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        // Fiş tasarım şablonu + künye burada gelir → detay/A4 ekranı ayrıca istek atmaz.
        company: {
          select: {
            name: true,
            receiptTemplate: true,
            address: true,
            phone: true,
            taxOffice: true,
            taxNumber: true,
          },
        },
        payments: {
          orderBy: { paymentDate: "asc" },
          include: { account: { select: { id: true, name: true } } },
        },
        convertedInvoice: { select: { id: true, slug: true, invoiceNo: true } },
      },
    })

    if (!receipt) return NextResponse.json({ error: "Fiş bulunamadı" }, { status: 404 })

    const direction = receipt.type === "SALES" ? "outgoing" : "incoming"
    const total = Number(receipt.totalAmount)
    const paid = receipt.payments.reduce((s, p) => s + Number(p.amount), 0)

    return NextResponse.json({
      id: receipt.id,
      slug: receipt.slug,
      receiptNo: receipt.invoiceNo,
      direction,
      status: receipt.status,
      date: receipt.date.toISOString(),
      createdAt: receipt.createdAt.toISOString(),
      companyName: receipt.company?.name ?? "",
      receiptTemplate: receipt.company?.receiptTemplate
        ? normalizeReceiptTemplate(receipt.company.receiptTemplate)
        : DEFAULT_RECEIPT_TEMPLATE,
      // Fişe basılacak künye — şablonda showAddress/showContact açıkken kullanılır.
      companyInfo: {
        address: receipt.company?.address ?? null,
        phone: receipt.company?.phone ?? null,
        taxOffice: receipt.company?.taxOffice ?? null,
        taxNumber: receipt.company?.taxNumber ?? null,
      },
      counterpartyId: direction === "incoming" ? receipt.supplierId : receipt.customerId,
      counterpartyName:
        (direction === "incoming" ? receipt.supplier?.name : receipt.customer?.name) ?? null,
      currency: receipt.currency,
      netAmount: Number(receipt.netAmount),
      vatAmount: Number(receipt.vatAmount),
      totalAmount: total,
      paidAmount: paid,
      // Liste ile aynı kural (app/api/fisler/route.ts): tam / kısmî / açık.
      paymentStatus: paid <= 0 ? "OPEN" : paid + 0.01 >= total ? "PAID" : "PARTIAL",
      notes: receipt.notes,
      // Dönüştürüldüyse hangi resmî faturaya gittiği — detaydan o faturaya geçilir.
      convertedInvoice: receipt.convertedInvoice
        ? {
            id: receipt.convertedInvoice.id,
            slug: receipt.convertedInvoice.slug,
            invoiceNo: receipt.convertedInvoice.invoiceNo,
          }
        : null,
      items: receipt.items.map((it) => ({
        id: it.id,
        description: it.description,
        quantity: Number(it.quantity),
        unit: it.unit,
        unitPrice: Number(it.unitPrice),
        vatRate: Number(it.vatRate),
        vatAmount: Number(it.vatAmount),
        totalAmount: Number(it.totalAmount),
      })),
      payments: receipt.payments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        paymentDate: p.paymentDate.toISOString(),
        paymentMethod: p.paymentMethod,
        paymentMethodLabel: PAYMENT_METHOD_LABEL[p.paymentMethod] ?? p.paymentMethod,
        accountName: p.account?.name ?? null,
      })),
    })
  } catch (error: any) {
    if (error?.message?.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching receipt:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
