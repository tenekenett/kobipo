import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { generateInvoiceNumber } from "@/lib/utils/invoice-number"
import { adjustWarehouseStock } from "@/lib/stock/warehouse"

export const dynamic = "force-dynamic"

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const quote = await prisma.quote.findUnique({
    where: { id },
    include: { items: true },
  })
  if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 })

  await ensureCompanyWrite(quote.companyId)

  if (quote.convertedInvoiceId) {
    return NextResponse.json({ error: "Quote already converted" }, { status: 400 })
  }

  // Müşterili teklif → satış faturası; tedarikçili teklif → alış faturası.
  const isSales = Boolean(quote.customerId)
  if (isSales && !quote.customerId) {
    return NextResponse.json(
      { error: "Satış faturası için teklifte müşteri seçilmelidir." },
      { status: 400 }
    )
  }
  if (!isSales && !quote.supplierId) {
    return NextResponse.json(
      { error: "Alış faturası için teklifte tedarikçi seçilmelidir." },
      { status: 400 }
    )
  }

  const buildInvoice = (invoiceNo: string) =>
    prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          companyId: quote.companyId,
          invoiceNo,
          type: isSales ? "SALES" : "PURCHASE",
          invoiceType: "MANUAL",
          customerId: quote.customerId,
          supplierId: quote.supplierId,
          date: quote.date,
          dueDate: quote.validUntil,
          totalAmount: quote.totalAmount,
          vatAmount: quote.vatAmount,
          netAmount: quote.netAmount,
          currency: quote.currency,
          notes: quote.notes,
          status: "DRAFT",
          createdBy: user.id,
          items: {
            create: quote.items.map((item, index) => ({
              ...(item.productId ? { product: { connect: { id: item.productId } } } : {}),
              description: item.description,
              // Satır açıklaması faturaya AYNI alanda taşınır (description'a
              // eklenmez): GİB belgesinde ürün adı temiz kalsın.
              note: item.note,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discountRate: item.discountRate,
              discountAmount: item.discountAmount,
              vatRate: item.vatRate,
              vatAmount: item.vatAmount,
              totalAmount: item.totalAmount,
              order: index,
            })),
          },
        },
        include: { items: true },
      })

      // Stok hareketi: depo bazlı (varsayılan depo). Satış azaltır, alış artırır.
      for (const item of quote.items) {
        if (!item.productId) continue
        await adjustWarehouseStock(tx, {
          companyId: quote.companyId,
          productId: item.productId,
          delta: isSales ? -Number(item.quantity) : Number(item.quantity),
          type: isSales ? "OUT" : "IN",
          unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
          description: `${invoiceNo} - ${isSales ? "Satış" : "Alış"} faturası (tekliften)`,
          reference: invoice.id,
          createdBy: user.id,
        })
      }

      await tx.quote.update({
        where: { id: quote.id },
        data: { status: "CONVERTED", convertedInvoiceId: invoice.id },
      })

      return invoice
    })

  // Fatura no üretimi transaction dışında olduğundan eşzamanlı isteklerde
  // mükerrer numara (P2002) oluşabilir; çakışmada yeni numara üretip yeniden dene.
  const invoiceType = isSales ? "SALES" : "PURCHASE"
  let result
  for (let attempt = 0; attempt < 5; attempt++) {
    const invoiceNo = await generateInvoiceNumber(quote.companyId, invoiceType, quote.date)
    try {
      result = await buildInvoice(invoiceNo)
      break
    } catch (error: any) {
      const isDuplicate = error?.code === "P2002"
      if (!isDuplicate || attempt === 4) {
        if (isDuplicate) {
          return NextResponse.json(
            { error: "Fatura numarası üretilemedi, lütfen tekrar deneyin" },
            { status: 409 },
          )
        }
        throw error
      }
    }
  }

  return NextResponse.json(result, { status: 201 })
}
