import { accessDeniedResponse, isAccessDeniedError, withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { generateInvoiceNumber } from "@/lib/utils/invoice-number"
import { ensureDefaultWarehouseId } from "@/lib/stock/warehouse"
import { prepareInvoiceStockOps, writeInvoiceStockOps } from "@/lib/stock/invoice-stock"
import { syncInvoiceAutoEntries } from "@/lib/invoice/auto-entries"
import { invoiceTotalsFromStoredItems } from "@/lib/invoice/document-totals"

export const dynamic = "force-dynamic"

export const POST = withApiErrors(async function POST(
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

  // Başlık toplamı kalemlerden RESMÎ BELGE kuralıyla kurulur (lib/invoice/document-totals.ts).
  // Yeni teklif zaten bu kuralla kaydediliyor; kural gelmeden önce kaydedilmiş
  // tekliflerin toplamı ise GİB'e gidecek belgeden 1–3 kuruş sapabiliyordu.
  const totals = invoiceTotalsFromStoredItems(quote.items, {
    globalDiscountAmount: quote.globalDiscountAmount,
  })

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
          totalAmount: totals.total,
          vatAmount: totals.vat,
          netAmount: totals.net,
          // Genel iskonto faturada da fatura altı iskontodur (UBL AllowanceCharge).
          globalDiscountAmount: totals.globalDiscount > 0 ? totals.globalDiscount : null,
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

      // STOK — fatura ucuyla AYNI yol (lib/stock/invoice-stock.ts): hizmet ürünü
      // elenir, satışta reçete hammaddeye açılır, iskonto maliyete girer. Öncesinde
      // burada ham `adjustWarehouseStock` çağrılıyor ve hizmet kalemi stoğa
      // düşüyor, reçeteli mamül kendi stoğundan gidiyordu.
      const ops = await prepareInvoiceStockOps(tx, {
        companyId: quote.companyId,
        type: invoice.type,
        invoiceNo,
        lines: invoice.items.map((item) => ({
          productId: item.productId,
          quantity: Number(item.quantity),
          unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
          discountAmount: item.discountAmount != null ? Number(item.discountAmount) : null,
          order: Number(item.order) || 0,
        })),
      })
      await writeInvoiceStockOps(tx, {
        companyId: quote.companyId,
        invoiceId: invoice.id,
        invoiceNo: `${invoiceNo} (tekliften)`,
        type: invoice.type,
        warehouseId: await ensureDefaultWarehouseId(tx, quote.companyId),
        ops,
        createdBy: user.id,
      })

      // Otomatik muhasebe fişi — doğrudan kesilen faturayla aynı (tek yazım yeri).
      await syncInvoiceAutoEntries(tx, {
        companyId: quote.companyId,
        invoiceId: invoice.id,
        invoiceNo,
        date: invoice.date,
        type: invoice.type,
        isReceipt: false,
        netAmount: invoice.netAmount,
        vatAmount: invoice.vatAmount,
        createdBy: user.id,
        suffix: "(tekliften)",
      })

      await tx.quote.update({
        where: { id: quote.id },
        data: { status: "CONVERTED", convertedInvoiceId: invoice.id },
      })

      return invoice
    }, { timeout: 20000 })

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
      // Kapı reddi (modül/sayfa/rol) 403 döner; buradaki diğer dallar veri hatası içindir.
      if (isAccessDeniedError(error)) return accessDeniedResponse(error)
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
})
