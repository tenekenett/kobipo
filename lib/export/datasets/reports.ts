/**
 * Rapor dışa aktarımları.
 *
 * Her rapor kendi hesabını `lib/raporlar/*` ya da mevcut sorgu katmanı
 * üzerinden alır — dışa aktarma hiçbir yerde kendi hesabını yapmaz. Aksi halde
 * ekranda 100.000 TL net kâr, PDF'te 98.400 TL çıkar ve hangisinin doğru
 * olduğunu kimse bilemez.
 */

import { prisma } from "@/lib/db/prisma"
import { resolveAllUnitCosts } from "@/lib/stock/cost"
import { computeCariAging } from "@/lib/raporlar/cari-yaslandirma"
import { computeProfitLoss } from "@/lib/raporlar/kar-zarar"
import type { ExportColumn, ExportDataset, ExportRow, ExportSection } from "../types"
import { loadExportCompany, describeDateRange, describeFilters } from "./context"

// --------------------------- STOK RAPORU ---------------------------

const STOCK_COLUMNS: ExportColumn[] = [
  { key: "code", label: "Kod", width: 22 },
  { key: "name", label: "Ürün Adı" },
  { key: "barcode", label: "Barkod", width: 26 },
  { key: "unit", label: "Birim", width: 14, align: "center" },
  { key: "stockQuantity", label: "Stok", type: "qty", width: 20 },
  { key: "minStockLevel", label: "Min.", type: "qty", width: 16 },
  { key: "statusLabel", label: "Durum", width: 20 },
  { key: "purchasePrice", label: "Alış", type: "money", width: 20 },
  { key: "salePrice", label: "Satış", type: "money", width: 20 },
  { key: "stockValue", label: "Stok Maliyeti", type: "money", width: 24, total: true },
  { key: "saleValue", label: "Stok Satış Değeri", type: "money", width: 26, total: true },
]

export type StockReportParams = {
  companyId: string
  search?: string | null
  /** "ALL" | "PRODUCT" | "SERVICE" */
  type?: string | null
  /** "ALL" | "LOW" | "OUT" | "NORMAL" */
  stock?: string | null
}

/** `/raporlar/stok` ekranındaki `stockStatus` ile birebir aynı kural. */
function stockStatusLabel(isService: boolean, quantity: number, minimum: number): string {
  if (isService) return "Hizmet"
  if (quantity <= 0) return "Stok Yok"
  if (minimum > 0 && quantity <= minimum) return "Kritik"
  return "Normal"
}

export async function buildStockReportDataset(params: StockReportParams): Promise<ExportDataset> {
  const [company, products, costByProduct] = await Promise.all([
    loadExportCompany(params.companyId),
    prisma.product.findMany({ where: { companyId: params.companyId }, orderBy: { name: "asc" } }),
    resolveAllUnitCosts(params.companyId),
  ])

  const typeFilter = params.type || "ALL"
  const stockFilter = params.stock || "ALL"
  const search = (params.search || "").toLowerCase()

  const filtered = products.filter((product) => {
    if (typeFilter === "PRODUCT" && product.isService) return false
    if (typeFilter === "SERVICE" && !product.isService) return false

    const quantity = Number(product.stockQuantity || 0)
    const minimum = Number(product.minStockLevel || 0)
    if (stockFilter === "OUT" && quantity > 0) return false
    if (stockFilter === "LOW" && !(minimum > 0 && quantity > 0 && quantity <= minimum)) return false
    if (stockFilter === "NORMAL" && (quantity <= 0 || (minimum > 0 && quantity <= minimum))) return false

    if (search) {
      const hit =
        product.name.toLowerCase().includes(search) ||
        (product.code || "").toLowerCase().includes(search) ||
        (product.barcode || "").toLowerCase().includes(search)
      if (!hit) return false
    }
    return true
  })

  const rows: ExportRow[] = filtered.map((product) => {
    const quantity = Number(product.stockQuantity || 0)
    const minimum = Number(product.minStockLevel || 0)
    const purchase = product.purchasePrice === null ? null : Number(product.purchasePrice)
    const sale = product.salePrice === null ? null : Number(product.salePrice)
    const unitCost = costByProduct.get(product.id) ?? purchase
    return {
      code: product.code,
      name: product.name,
      barcode: product.barcode,
      unit: product.unit,
      stockQuantity: product.isService ? null : quantity,
      minStockLevel: product.minStockLevel,
      statusLabel: stockStatusLabel(product.isService, quantity, minimum),
      purchasePrice: purchase,
      salePrice: sale,
      stockValue: product.isService || unitCost === null ? null : quantity * unitCost,
      saleValue: product.isService || sale === null ? null : quantity * sale,
    }
  })

  // Özet — ekrandaki kartların aynısı. PDF'i açan kişi tek bakışta durumu görsün.
  const onlyProducts = products.filter((product) => !product.isService)
  const totalStockValue = onlyProducts.reduce(
    (sum, product) => sum + Number(product.stockQuantity || 0) * Number(product.purchasePrice || 0),
    0,
  )
  const totalSaleValue = onlyProducts.reduce(
    (sum, product) => sum + Number(product.stockQuantity || 0) * Number(product.salePrice || 0),
    0,
  )
  const summary: ExportSection = {
    title: "Özet",
    sheetName: "Özet",
    columns: [
      { key: "metric", label: "Gösterge", width: 60 },
      { key: "value", label: "Değer", type: "money", width: 40 },
    ],
    totals: null,
    rows: [
      { metric: "Ürün adedi", value: onlyProducts.length },
      { metric: "Hizmet adedi", value: products.length - onlyProducts.length },
      { metric: "Toplam stok maliyeti", value: totalStockValue },
      { metric: "Toplam stok satış değeri", value: totalSaleValue },
      { metric: "Potansiyel kâr", value: totalSaleValue - totalStockValue },
      {
        metric: "Kritik seviyedeki ürün",
        value: onlyProducts.filter((product) => {
          const quantity = Number(product.stockQuantity || 0)
          const minimum = Number(product.minStockLevel || 0)
          return minimum > 0 && quantity <= minimum && quantity > 0
        }).length,
      },
      {
        metric: "Stoğu tükenen ürün",
        value: onlyProducts.filter((product) => Number(product.stockQuantity || 0) <= 0).length,
      },
    ],
  }

  return {
    title: "Stok Raporu",
    company,
    filters: describeFilters([
      ["Arama", params.search],
      ["Tür", typeFilter === "PRODUCT" ? "Ürün" : typeFilter === "SERVICE" ? "Hizmet" : null],
      [
        "Stok durumu",
        stockFilter === "LOW"
          ? "Kritik"
          : stockFilter === "OUT"
            ? "Stok yok"
            : stockFilter === "NORMAL"
              ? "Normal"
              : null,
      ],
    ]),
    sections: [summary, { title: "Ürünler", sheetName: "Ürünler", columns: STOCK_COLUMNS, rows }],
    generatedAt: new Date(),
  }
}

// --------------------------- CARİ YAŞLANDIRMA ---------------------------

const AGING_COLUMNS: ExportColumn[] = [
  { key: "code", label: "Kod", width: 22 },
  { key: "name", label: "Ünvan" },
  { key: "taxNumber", label: "VKN/TCKN", width: 26 },
  { key: "paymentDueDays", label: "Vade (gün)", type: "number", width: 20 },
  { key: "notDue", label: "Vadesi Gelmemiş", type: "money", width: 28, total: true },
  { key: "overdue", label: "Vadesi Geçmiş", type: "money", width: 26, total: true },
  { key: "overdueAvgDays", label: "Ort. Gecikme (gün)", type: "number", width: 26 },
  { key: "total", label: "Toplam Açık", type: "money", width: 26, total: true },
  { key: "performanceLabel", label: "Ödeme Davranışı", width: 26 },
  { key: "performanceScore", label: "Skor", type: "number", width: 16 },
]

export async function buildAgingReportDataset(params: { companyId: string }): Promise<ExportDataset> {
  const [company, aging] = await Promise.all([
    loadExportCompany(params.companyId),
    computeCariAging(params.companyId),
  ])

  const toRows = (accounts: typeof aging.customers.accounts): ExportRow[] =>
    accounts.map((account) => ({
      code: account.code,
      name: account.name,
      taxNumber: account.taxNumber,
      paymentDueDays: account.paymentDueDays,
      notDue: account.totals.not_due,
      overdue: account.totals.overdue,
      overdueAvgDays: account.totals.overdueAvgDays,
      total: account.totals.total,
      performanceLabel: account.totals.performanceLabel,
      performanceScore: account.totals.performanceScore,
    }))

  return {
    title: "Cari Yaşlandırma",
    company,
    filters: describeFilters([["Rapor tarihi", new Date().toLocaleDateString("tr-TR")]]),
    sections: [
      {
        title: "Müşteriler (Alacaklar)",
        sheetName: "Alacaklar",
        columns: AGING_COLUMNS,
        rows: toRows(aging.customers.accounts),
      },
      {
        title: "Tedarikçiler (Borçlar)",
        sheetName: "Borçlar",
        columns: AGING_COLUMNS,
        rows: toRows(aging.suppliers.accounts),
      },
    ],
    generatedAt: new Date(),
  }
}

// --------------------------- KAR / ZARAR ---------------------------

export type ProfitLossExportParams = {
  companyId: string
  startDate?: string | null
  endDate?: string | null
}

export async function buildProfitLossDataset(params: ProfitLossExportParams): Promise<ExportDataset> {
  const [company, report] = await Promise.all([
    loadExportCompany(params.companyId),
    computeProfitLoss(params),
  ])

  const columns: ExportColumn[] = [
    { key: "label", label: "Kalem", width: 90 },
    { key: "amount", label: "Tutar", type: "money", width: 45 },
  ]

  return {
    title: "Kar-Zarar Tablosu",
    company,
    orientation: "portrait",
    filters: describeFilters([
      ["Dönem", describeDateRange(report.period.startDate, report.period.endDate)],
    ]),
    sections: [
      {
        title: "Gelirler",
        sheetName: "Gelirler",
        columns,
        totals: { label: "Toplam Gelir", amount: report.revenue.total },
        rows: [
          { label: "Satış gelirleri (fatura matrahı)", amount: report.revenue.sales },
          { label: "Diğer gelirler (faturasız)", amount: report.revenue.other },
        ],
      },
      {
        title: "Giderler",
        sheetName: "Giderler",
        columns,
        totals: {
          label: "Toplam Gider",
          amount: report.costOfGoodsSold + report.operatingExpenses,
        },
        rows: [
          { label: "Satılan malın maliyeti (alış matrahı)", amount: report.costOfGoodsSold },
          { label: "Faaliyet giderleri (faturasız)", amount: report.operatingExpenses },
        ],
      },
      {
        title: "Sonuç",
        sheetName: "Sonuç",
        columns,
        totals: null,
        rows: [
          { label: "Brüt kâr", amount: report.grossProfit },
          { label: "Faaliyet giderleri", amount: report.operatingExpenses },
          { label: "NET KÂR / ZARAR", amount: report.netProfit },
        ],
      },
    ],
    generatedAt: new Date(),
  }
}
