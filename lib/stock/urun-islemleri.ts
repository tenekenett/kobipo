/**
 * Ürün kartındaki "Ürüne Ait Son 100 İşlem" — sorgu katmanı (kural:
 * `urun-islemleri-kural.ts`). Uç (`/api/stok/products/[id]/islemler`) ve dışa
 * aktarım (`urun-islemleri`) bu fonksiyonu çağırır; ekran ile dosya aynı satırı verir.
 */

import { prisma } from "@/lib/db/prisma"
import {
  invoiceLineToRow,
  mergeTransactions,
  waybillLineToRow,
  type ProductTransactionRow,
} from "./urun-islemleri-kural"

export type { ProductTransactionRow } from "./urun-islemleri-kural"

/** Ekranın başlığındaki sayı ("Son 100 İşlem"). */
export const PRODUCT_TRANSACTION_LIMIT = 100

const PARTY = { select: { id: true, slug: true, name: true } } as const

export async function computeProductTransactions(args: {
  companyId: string
  productId: string
  limit?: number
}): Promise<ProductTransactionRow[]> {
  const limit = args.limit ?? PRODUCT_TRANSACTION_LIMIT
  const { companyId, productId } = args

  // Her kaynaktan en yeni `limit` satır çekilir, birleşip yine `limit`e kesilir:
  // birleşik listenin ilk `limit` satırı ikisinin de ilk `limit`i içindedir.
  const [invoiceItems, waybillItems] = await Promise.all([
    prisma.invoiceItem.findMany({
      where: {
        productId,
        // Faturaya dönüşmüş fiş alınmaz: kalemi birleşik faturada zaten var.
        invoice: { companyId, status: { not: "CONVERTED" } },
      },
      orderBy: [{ invoice: { date: "desc" } }, { invoice: { createdAt: "desc" } }],
      take: limit,
      select: {
        id: true,
        quantity: true,
        unit: true,
        totalAmount: true,
        invoice: {
          select: {
            id: true,
            invoiceNo: true,
            eDocumentNo: true,
            date: true,
            type: true,
            returnKind: true,
            invoiceType: true,
            isReceipt: true,
            status: true,
            currency: true,
            totalAmount: true,
            customer: PARTY,
            supplier: PARTY,
            payments: { select: { amount: true, paymentMethod: true } },
            waybills: { select: { waybillNo: true, date: true, deliveryDate: true } },
          },
        },
      },
    }),
    // Faturaya BAĞLANMAMIŞ irsaliyeler; bağlı olan faturanın satırında görünür.
    prisma.waybillItem.findMany({
      where: { productId, waybill: { companyId, invoiceId: null } },
      orderBy: [{ waybill: { date: "desc" } }],
      take: limit,
      select: {
        id: true,
        quantity: true,
        unit: true,
        waybill: {
          select: {
            id: true,
            waybillNo: true,
            type: true,
            status: true,
            date: true,
            deliveryDate: true,
            customer: PARTY,
            supplier: PARTY,
          },
        },
      },
    }),
  ])

  const rows = [
    ...invoiceItems.map((item) =>
      invoiceLineToRow({
        id: item.id,
        quantity: Number(item.quantity),
        unit: item.unit,
        totalAmount: Number(item.totalAmount),
        invoice: {
          ...item.invoice,
          totalAmount: Number(item.invoice.totalAmount),
          payments: item.invoice.payments.map((p) => ({ amount: Number(p.amount), paymentMethod: p.paymentMethod })),
        },
      }),
    ),
    ...waybillItems.map((item) =>
      waybillLineToRow({ id: item.id, quantity: Number(item.quantity), unit: item.unit, waybill: item.waybill }),
    ),
  ]
  return mergeTransactions(rows, limit)
}
