import "server-only"

import { cache } from "react"
import { prisma } from "@/lib/db/prisma"

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (typeof value === "number") return value
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (typeof value === "object" && value && "toString" in value) {
    const parsed = Number((value as { toString: () => string }).toString())
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

// ---------- Accountant ----------

export interface AccountantStats {
  customerCount: number
  supplierCount: number
  invoiceCount: number
  pendingInvoices: number
  income: number
  expense: number
}

export const getAccountantStats = cache(async function getAccountantStats(
  companyId: string
): Promise<AccountantStats> {
  const rows = await prisma.$queryRaw<
    Array<{
      customer_count: bigint
      supplier_count: bigint
      invoice_count: bigint
      pending_count: bigint
      income_total: string | null
      expense_total: string | null
    }>
  >`
    SELECT
      (SELECT COUNT(*) FROM "customers" WHERE "companyId" = ${companyId}) AS customer_count,
      (SELECT COUNT(*) FROM "suppliers" WHERE "companyId" = ${companyId}) AS supplier_count,
      -- Fişler resmî belge değil → fatura sayısına ve "bekleyen" sayısına girmez
      -- (fişler de DRAFT açılır; filtresiz kalırsa her fiş bekleyen fatura görünür).
      (SELECT COUNT(*) FROM "invoices" WHERE "companyId" = ${companyId} AND "isReceipt" = false) AS invoice_count,
      (SELECT COUNT(*) FROM "invoices" WHERE "companyId" = ${companyId} AND "isReceipt" = false AND "status" = 'DRAFT') AS pending_count,
      (SELECT COALESCE(SUM(amount), 0) FROM "transactions" WHERE "companyId" = ${companyId} AND "type" = 'INCOME') AS income_total,
      (SELECT COALESCE(SUM(amount), 0) FROM "transactions" WHERE "companyId" = ${companyId} AND "type" = 'EXPENSE') AS expense_total
  `
  const r = rows[0]
  return {
    customerCount: toNumber(r?.customer_count),
    supplierCount: toNumber(r?.supplier_count),
    invoiceCount: toNumber(r?.invoice_count),
    pendingInvoices: toNumber(r?.pending_count),
    income: toNumber(r?.income_total),
    expense: toNumber(r?.expense_total),
  }
})

export const getRecentTransactions = cache(async function getRecentTransactions(
  companyId: string,
  take = 10
) {
  return prisma.transaction.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      type: true,
      amount: true,
      description: true,
      customer: { select: { name: true } },
      supplier: { select: { name: true } },
      account: { select: { name: true } },
    },
  })
})

// ---------- Sales ----------

export interface SalesStats {
  customerCount: number
  productCount: number
  monthlyInvoices: number
  monthlySalesTotal: number
}

export const getSalesStats = cache(async function getSalesStats(
  companyId: string
): Promise<SalesStats> {
  const thirty = new Date()
  thirty.setDate(thirty.getDate() - 30)

  const rows = await prisma.$queryRaw<
    Array<{
      customer_count: bigint
      product_count: bigint
      monthly_invoice_count: bigint
      monthly_sales_total: string | null
    }>
  >`
    SELECT
      (SELECT COUNT(*) FROM "customers" WHERE "companyId" = ${companyId}) AS customer_count,
      (SELECT COUNT(*) FROM "products" WHERE "companyId" = ${companyId} AND "isActive" = true) AS product_count,
      -- Ekonomik ciro → fişler dâhil, ama iptal ve faturaya dönüştürülmüş fişler hariç
      -- (dönüşen fişin yerine konsolide fatura sayılır; ikisi de sayılırsa ciro çift olur).
      (SELECT COUNT(*) FROM "invoices" WHERE "companyId" = ${companyId} AND "type" = 'SALES' AND "status" NOT IN ('CANCELLED', 'CONVERTED') AND "createdAt" >= ${thirty}) AS monthly_invoice_count,
      -- Ciro NET'tir: satış iadesi düşülür. Düşülmezse geri gelen mal satılmış
      -- gibi durur ve panodaki 30 günlük ciro gerçeğin üstünde görünür.
      -- (İade yönü NULL = satış iadesi; bkz. lib/cari/invoice-direction.ts.)
      (SELECT COALESCE(SUM(CASE WHEN "type" = 'RETURN' THEN -"totalAmount" ELSE "totalAmount" END), 0)
         FROM "invoices"
        WHERE "companyId" = ${companyId}
          AND ("type" = 'SALES'
               OR ("type" = 'RETURN' AND COALESCE("returnKind", 'SALES') <> 'PURCHASE'))
          AND "status" NOT IN ('CANCELLED', 'CONVERTED')
          AND "createdAt" >= ${thirty}) AS monthly_sales_total
  `
  const r = rows[0]
  return {
    customerCount: toNumber(r?.customer_count),
    productCount: toNumber(r?.product_count),
    monthlyInvoices: toNumber(r?.monthly_invoice_count),
    monthlySalesTotal: toNumber(r?.monthly_sales_total),
  }
})

export const getRecentSalesInvoices = cache(async function getRecentSalesInvoices(
  companyId: string,
  take = 5
) {
  return prisma.invoice.findMany({
    where: { companyId, type: "SALES" },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      invoiceNo: true,
      totalAmount: true,
      createdAt: true,
      customer: { select: { name: true } },
    },
  })
})

export interface TopCustomer {
  customerId: string
  customerName: string
  invoiceCount: number
  totalAmount: number
}

export const getTopCustomers = cache(async function getTopCustomers(
  companyId: string,
  take = 5
): Promise<TopCustomer[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      name: string
      invoice_count: bigint
      total_amount: string | null
    }>
  >`
    SELECT c.id AS id,
           c.name AS name,
           COUNT(i.id)::bigint AS invoice_count,
           COALESCE(SUM(i."totalAmount"), 0) AS total_amount
    FROM "invoices" i
    JOIN "customers" c ON c.id = i."customerId"
    WHERE i."companyId" = ${companyId}
      AND i."type" = 'SALES'
      AND i."customerId" IS NOT NULL
    GROUP BY c.id, c.name
    ORDER BY total_amount DESC
    LIMIT ${take}
  `
  return rows.map((row) => ({
    customerId: row.id,
    customerName: row.name,
    invoiceCount: toNumber(row.invoice_count),
    totalAmount: toNumber(row.total_amount),
  }))
})

// ---------- Stock ----------

export interface StockStats {
  totalProducts: number
  activeProducts: number
  lowStockCount: number
  totalStockQuantity: number
}

export const getStockStats = cache(async function getStockStats(
  companyId: string
): Promise<StockStats> {
  const rows = await prisma.$queryRaw<
    Array<{
      total_products: bigint
      active_products: bigint
      low_stock_count: bigint
      total_stock: string | null
    }>
  >`
    SELECT
      (SELECT COUNT(*) FROM "products" WHERE "companyId" = ${companyId}) AS total_products,
      (SELECT COUNT(*) FROM "products" WHERE "companyId" = ${companyId} AND "isActive" = true) AS active_products,
      (SELECT COUNT(*) FROM "products" WHERE "companyId" = ${companyId} AND "isActive" = true AND "isService" = false AND "stockQuantity" < 10) AS low_stock_count,
      (SELECT COALESCE(SUM("stockQuantity"), 0) FROM "products" WHERE "companyId" = ${companyId} AND "isService" = false) AS total_stock
  `
  const r = rows[0]
  return {
    totalProducts: toNumber(r?.total_products),
    activeProducts: toNumber(r?.active_products),
    lowStockCount: toNumber(r?.low_stock_count),
    totalStockQuantity: toNumber(r?.total_stock),
  }
})

export const getLowStockProducts = cache(async function getLowStockProducts(
  companyId: string,
  take = 5
) {
  return prisma.product.findMany({
    where: {
      companyId,
      isActive: true,
      stockQuantity: { lt: 10 },
      isService: false,
    },
    orderBy: { stockQuantity: "asc" },
    take,
    select: {
      id: true,
      name: true,
      code: true,
      unit: true,
      stockQuantity: true,
    },
  })
})

export const getRecentStockMovements = cache(async function getRecentStockMovements(
  companyId: string,
  take = 10
) {
  return prisma.stockMovement.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      type: true,
      quantity: true,
      description: true,
      product: { select: { name: true } },
    },
  })
})

export interface TopMovingProduct {
  productId: string
  productName: string
  movementCount: number
}

export const getTopMovingProducts = cache(async function getTopMovingProducts(
  companyId: string,
  take = 5
): Promise<TopMovingProduct[]> {
  const rows = await prisma.$queryRaw<
    Array<{ id: string; name: string; movement_count: bigint }>
  >`
    SELECT p.id AS id,
           p.name AS name,
           COUNT(sm.id)::bigint AS movement_count
    FROM "stock_movements" sm
    JOIN "products" p ON p.id = sm."productId"
    WHERE sm."companyId" = ${companyId}
    GROUP BY p.id, p.name
    ORDER BY movement_count DESC
    LIMIT ${take}
  `
  return rows.map((r) => ({
    productId: r.id,
    productName: r.name,
    movementCount: toNumber(r.movement_count),
  }))
})
