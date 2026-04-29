import "server-only"

import { cache } from "react"
import { prisma } from "@/lib/db/prisma"

export interface AdminStats {
  customerCount: number
  supplierCount: number
  productCount: number
  invoiceCount: number
  userCount: number
  income: number
  expense: number
}

export interface MonthlyCashflowRow {
  month: string
  income: number
  expense: number
}

const TR_MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"]

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

/**
 * Single round-trip aggregation: 5 row counts + 2 SUM(amount) totals.
 * Replaces 7 parallel Prisma queries. Memoized per request via React cache().
 */
export const getAdminStats = cache(_getAdminStats)

async function _getAdminStats(companyId: string): Promise<AdminStats> {
  const rows = await prisma.$queryRaw<
    Array<{
      customer_count: bigint | number
      supplier_count: bigint | number
      product_count: bigint | number
      invoice_count: bigint | number
      user_count: bigint | number
      income_total: string | number | null
      expense_total: string | number | null
    }>
  >`
    SELECT
      (SELECT COUNT(*) FROM "customers" WHERE "companyId" = ${companyId}) AS customer_count,
      (SELECT COUNT(*) FROM "suppliers" WHERE "companyId" = ${companyId}) AS supplier_count,
      (SELECT COUNT(*) FROM "products" WHERE "companyId" = ${companyId}) AS product_count,
      (SELECT COUNT(*) FROM "invoices" WHERE "companyId" = ${companyId}) AS invoice_count,
      (SELECT COUNT(*) FROM "user_companies" WHERE "companyId" = ${companyId}) AS user_count,
      (SELECT COALESCE(SUM(amount), 0) FROM "transactions" WHERE "companyId" = ${companyId} AND "type" = 'INCOME') AS income_total,
      (SELECT COALESCE(SUM(amount), 0) FROM "transactions" WHERE "companyId" = ${companyId} AND "type" = 'EXPENSE') AS expense_total
  `

  const row = rows[0] ?? {
    customer_count: 0,
    supplier_count: 0,
    product_count: 0,
    invoice_count: 0,
    user_count: 0,
    income_total: 0,
    expense_total: 0,
  }

  return {
    customerCount: toNumber(row.customer_count),
    supplierCount: toNumber(row.supplier_count),
    productCount: toNumber(row.product_count),
    invoiceCount: toNumber(row.invoice_count),
    userCount: toNumber(row.user_count),
    income: toNumber(row.income_total),
    expense: toNumber(row.expense_total),
  }
}

/**
 * Single round-trip monthly aggregation for the last 6 months.
 * Replaces 12 parallel Prisma aggregates.
 */
export const getMonthlyCashflow = cache(_getMonthlyCashflow)

async function _getMonthlyCashflow(
  companyId: string,
  monthsBack = 6
): Promise<MonthlyCashflowRow[]> {
  const start = new Date()
  start.setMonth(start.getMonth() - (monthsBack - 1))
  start.setDate(1)
  start.setHours(0, 0, 0, 0)

  const rows = await prisma.$queryRaw<
    Array<{ month: Date; income: string | number | null; expense: string | number | null }>
  >`
    SELECT
      date_trunc('month', "date")::date AS month,
      SUM(CASE WHEN "type" = 'INCOME' THEN amount ELSE 0 END) AS income,
      SUM(CASE WHEN "type" = 'EXPENSE' THEN amount ELSE 0 END) AS expense
    FROM "transactions"
    WHERE "companyId" = ${companyId} AND "date" >= ${start}
    GROUP BY 1
    ORDER BY 1 ASC
  `

  const byKey = new Map<string, { income: number; expense: number }>()
  for (const row of rows) {
    const monthDate = new Date(row.month)
    const key = `${monthDate.getFullYear()}-${monthDate.getMonth()}`
    byKey.set(key, {
      income: toNumber(row.income),
      expense: toNumber(row.expense),
    })
  }

  const out: MonthlyCashflowRow[] = []
  const cursor = new Date(start)
  for (let i = 0; i < monthsBack; i++) {
    const key = `${cursor.getFullYear()}-${cursor.getMonth()}`
    const monthLabel = `${TR_MONTHS[cursor.getMonth()]} ${String(cursor.getFullYear()).slice(-2)}`
    const value = byKey.get(key) ?? { income: 0, expense: 0 }
    out.push({ month: monthLabel, income: value.income, expense: value.expense })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return out
}

export const getRecentInvoices = cache(_getRecentInvoices)

async function _getRecentInvoices(companyId: string, take = 5) {
  return prisma.invoice.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      invoiceNo: true,
      status: true,
      totalAmount: true,
      customer: { select: { name: true } },
      supplier: { select: { name: true } },
    },
  })
}
