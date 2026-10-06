/**
 * Ürün kartındaki "Ürüne Ait Son 100 İşlem" tablosunun dışa aktarımı.
 *
 * Satırlar ekranla AYNI fonksiyondan gelir (`computeProductTransactions`); ekranın
 * araması ve sıralaması da aynı saf kurallarla uygulanır — kullanıcı tabloda
 * süzüp sıraladığı listeyi indirir.
 */

import { prisma } from "@/lib/db/prisma"
import { computeProductTransactions, PRODUCT_TRANSACTION_LIMIT } from "@/lib/stock/urun-islemleri"
import {
  filterTransactions,
  isTransactionSortKey,
  sortTransactions,
} from "@/lib/stock/urun-islemleri-kural"
import { trMatcher } from "@/lib/text/tr-fold"
import { BadRequestError } from "@/lib/http/query-params"
import type { ExportColumn, ExportDataset } from "../types"
import { describeFilters, loadExportCompany } from "./context"

export async function buildProductTransactionsDataset(params: {
  companyId: string
  productId: string | null
  search?: string | null
  sort?: string | null
  dir?: string | null
}): Promise<ExportDataset> {
  if (!params.productId) throw new BadRequestError("productId zorunlu")
  // Ürün İSTEKTEKİ firmanın olmalı: dışa aktarma kapısı firmayı doğruladı, ürünü değil.
  const product = await prisma.product.findFirst({
    where: { id: params.productId, companyId: params.companyId },
    select: { id: true, name: true, code: true },
  })
  if (!product) throw new BadRequestError("Ürün bu firmada bulunamadı")

  const [company, all] = await Promise.all([
    loadExportCompany(params.companyId),
    computeProductTransactions({ companyId: params.companyId, productId: product.id }),
  ])

  const search = (params.search || "").trim()
  const filtered = search ? filterTransactions(all, trMatcher(search)) : all
  const sortKey = isTransactionSortKey(params.sort) ? params.sort : "date"
  const dir = params.dir === "asc" ? "asc" : "desc"
  const rows = sortTransactions(filtered, sortKey, dir).map((row, index) => ({
    ...row,
    order: index + 1,
    typeText: row.statusTag ? `${row.typeLabel} (${row.statusTag})` : row.typeLabel,
  }))
  const hasForeign = rows.some((row) => row.currency !== "TRY")

  const columns: ExportColumn[] = [
    { key: "order", label: "Sıra", type: "number", width: 12, align: "center" },
    { key: "typeText", label: "Tür", width: 30 },
    { key: "documentNo", label: "Fatura No", width: 32 },
    { key: "date", label: "İşlem Tarihi", type: "date", width: 22 },
    { key: "counterpartyName", label: "Firma" },
    { key: "waybillNos", label: "İrsaliye No", width: 28 },
    { key: "recordNo", label: "Kayıt No", width: 32 },
    { key: "shipmentDate", label: "Sevk Tarihi", type: "date", width: 22 },
    { key: "paymentLabel", label: "Ödeme Tipi", width: 28 },
    { key: "quantity", label: "Miktar", type: "qty", width: 18 },
    { key: "unit", label: "Birim", width: 14, align: "center" },
    { key: "unitPriceGross", label: "Birim (KDV Dahil)", type: "money", width: 26 },
    { key: "totalGross", label: "Toplam (KDV Dahil)", type: "money", width: 28 },
    ...(hasForeign ? ([{ key: "currency", label: "Döviz", width: 14, align: "center" }] satisfies ExportColumn[]) : []),
  ]

  return {
    title: `Ürüne Ait Son ${PRODUCT_TRANSACTION_LIMIT} İşlem`,
    company,
    filters: describeFilters([
      ["Ürün", product.code ? `${product.code} · ${product.name}` : product.name],
      ["Arama", search || null],
      ["Kayıt", rows.length],
    ]),
    // Toplam satırı YOK: satış ve alış aynı listede, toplamları anlamsız olurdu.
    sections: [{ title: product.name, sheetName: "İşlemler", columns, rows, totals: null }],
    generatedAt: new Date(),
  }
}
