import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { Prisma } from "@prisma/client"

export const dynamic = 'force-dynamic'
const LIST_CACHE_TTL_MS = 15000
const listCache = new Map<string, { expiresAt: number; payload: unknown }>()

function parseOpeningBalanceType(value: unknown) {
  return String(value || "").toUpperCase() === "CREDIT" ? "CREDIT" : "DEBIT"
}

function parsePaymentDueDays(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseDecimalOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toBool(value: unknown): boolean {
  if (value === true || value === 1) return true
  if (value === false || value === 0 || value === null || value === undefined || value === "") return false
  if (typeof value === "string") {
    const normalized = value.toLowerCase().trim()
    return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on"
  }
  return Boolean(value)
}


export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get("companyId")
    const search = searchParams.get("search")
    const page = Number(searchParams.get("page") || "1")
    const pageSize = Number(searchParams.get("pageSize") || "50")
    const usePagination = searchParams.has("page") || searchParams.has("pageSize")

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    const safePage = Number.isFinite(page) && page > 0 ? page : 1
    const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 200) : 50
    const offset = (safePage - 1) * safePageSize
    const hasSearch = Boolean(search && search.trim().length > 0)
    const searchLike = `%${search?.trim() || ""}%`
    const cacheKey = `${companyId}|${searchLike}|${safePage}|${safePageSize}|${usePagination ? "1" : "0"}`

    const now = Date.now()
    const cached = listCache.get(cacheKey)
    if (cached && cached.expiresAt > now) {
      return NextResponse.json(cached.payload)
    }

    const [suppliers, countRows] = await Promise.all([
      prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      WITH filtered_suppliers AS (
        SELECT s.*
        FROM suppliers s
        WHERE s."companyId" = ${companyId}
          AND s."archivedAt" IS NULL
          ${hasSearch
            ? Prisma.sql`AND (
              s.name ILIKE ${searchLike}
              OR s.code ILIKE ${searchLike}
              OR s."taxNumber" ILIKE ${searchLike}
              OR s.email ILIKE ${searchLike}
            )`
            : Prisma.empty}
      ),
      paged_suppliers AS (
        SELECT *
        FROM filtered_suppliers
        ORDER BY name ASC
        ${usePagination ? Prisma.sql`LIMIT ${safePageSize} OFFSET ${offset}` : Prisma.empty}
      ),
      invoice_totals AS (
        SELECT i."supplierId", SUM(i."totalAmount") AS total_amount_sum
        FROM invoices i
        INNER JOIN paged_suppliers ps ON ps.id = i."supplierId"
        WHERE i.type = 'PURCHASE'
        GROUP BY i."supplierId"
      ),
      payment_totals AS (
        SELECT inv."supplierId", SUM(ip.amount) AS payment_amount_sum
        FROM invoice_payments ip
        INNER JOIN invoices inv ON inv.id = ip."invoiceId"
        INNER JOIN paged_suppliers ps ON ps.id = inv."supplierId"
        WHERE inv.type = 'PURCHASE'
        GROUP BY inv."supplierId"
      ),
      income_totals AS (
        SELECT t."supplierId", SUM(t.amount) AS amount_sum
        FROM transactions t
        INNER JOIN paged_suppliers ps ON ps.id = t."supplierId"
        WHERE t.type = 'INCOME'
        GROUP BY t."supplierId"
      ),
      expense_totals AS (
        SELECT t."supplierId", SUM(t.amount) AS amount_sum
        FROM transactions t
        INNER JOIN paged_suppliers ps ON ps.id = t."supplierId"
        WHERE t.type = 'EXPENSE'
        GROUP BY t."supplierId"
      )
      SELECT
        ps.id,
        ps."companyId",
        ps.code,
        ps.name,
        ps."taxNumber",
        ps."taxOffice",
        ps.address,
        ps.city,
        ps.country,
        ps.phone,
        ps.email,
        ps."contactPerson",
        ps."paymentDueDays",
        ps."openingBalanceAmount",
        ps."openingBalanceType",
        ps."riskLimit",
        ps."bankInfo",
        ps.note,
        ps."classification1Id",
        ps."classification2Id",
        ps."authorizedUserId",
        ps."isAlsoCustomer",
        ps."linkedCustomerId",
        ps."createdAt",
        ps."updatedAt",
        COALESCE(CAST(i.total_amount_sum AS NUMERIC), 0) AS "invoiceTotal",
        COALESCE(CAST(p.payment_amount_sum AS NUMERIC), 0) AS "paymentTotal",
        COALESCE(CAST(t_in.amount_sum AS NUMERIC), 0) AS "incomeTotal",
        COALESCE(CAST(t_ex.amount_sum AS NUMERIC), 0) AS "expenseTotal"
      FROM paged_suppliers ps
      LEFT JOIN invoice_totals i ON i."supplierId" = ps.id
      LEFT JOIN payment_totals p ON p."supplierId" = ps.id
      LEFT JOIN income_totals t_in ON t_in."supplierId" = ps.id
      LEFT JOIN expense_totals t_ex ON t_ex."supplierId" = ps.id
      ORDER BY ps.name ASC
    `),
      usePagination
        ? prisma.$queryRaw<Array<{ total_count: bigint | number }>>(Prisma.sql`
            SELECT COUNT(*) AS total_count
            FROM suppliers s
            WHERE s."companyId" = ${companyId}
            AND s."archivedAt" IS NULL
            ${hasSearch
              ? Prisma.sql`AND (
                s.name ILIKE ${searchLike}
                OR s.code ILIKE ${searchLike}
                OR s."taxNumber" ILIKE ${searchLike}
                OR s.email ILIKE ${searchLike}
              )`
              : Prisma.empty}
          `)
        : Promise.resolve([] as Array<{ total_count: bigint | number }>),
    ])

    const suppliersWithBalance = suppliers.map((row) => {
      const balance =
        Number(row.invoiceTotal || 0) -
        Number(row.paymentTotal || 0) +
        Number(row.expenseTotal || 0) -
        Number(row.incomeTotal || 0) +
        (row.openingBalanceType === "CREDIT"
          ? -Number(row.openingBalanceAmount || 0)
          : Number(row.openingBalanceAmount || 0))

      const { invoiceTotal, paymentTotal, incomeTotal, expenseTotal, ...supplier } = row
      return {
        ...supplier,
        balance,
      }
    })

    if (usePagination) {
      const totalCount = Number(countRows[0]?.total_count || 0)
      const payload = { items: suppliersWithBalance, totalCount, page: safePage, pageSize: safePageSize }
      listCache.set(cacheKey, { expiresAt: now + LIST_CACHE_TTL_MS, payload })
      return NextResponse.json(payload)
    }

    listCache.set(cacheKey, { expiresAt: now + LIST_CACHE_TTL_MS, payload: suppliersWithBalance })
    return NextResponse.json(suppliersWithBalance)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching suppliers:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const {
      companyId,
      code,
      name,
      taxNumber,
      taxOffice,
      address,
      city,
      phone,
      email,
      contactPerson,
      paymentDueDays,
      openingBalanceAmount,
      openingBalanceType,
      riskLimit,
      bankInfo,
      note,
      classification1Id,
      classification2Id,
      authorizedUserId,
      isAlsoCustomer,
    } = body

    if (!companyId || !name) {
      return NextResponse.json(
        { error: "companyId and name are required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)
    const parsedOpeningBalanceAmount =
      openingBalanceAmount !== undefined && openingBalanceAmount !== null && openingBalanceAmount !== ""
        ? Number(openingBalanceAmount)
        : 0
    const parsedRiskLimit = parseDecimalOrNull(riskLimit)
    const parsedOpeningBalanceType = parseOpeningBalanceType(openingBalanceType)

    const supplier = await prisma.$transaction(async (tx) => {
      const normalizedClassification1Id = classification1Id ? String(classification1Id) : null
      const normalizedClassification2Id = classification2Id ? String(classification2Id) : null
      const normalizedAuthorizedUserId = authorizedUserId ? String(authorizedUserId) : null

      if (normalizedClassification1Id) {
        const classification1 = await tx.companyDefinition.findFirst({
          where: { id: normalizedClassification1Id, companyId, type: "CLASS_1", isActive: true },
          select: { id: true },
        })
        if (!classification1) throw new Error("Sınıflandırma 1 kaydı bulunamadı")
      }
      if (normalizedClassification2Id) {
        const classification2 = await tx.companyDefinition.findFirst({
          where: { id: normalizedClassification2Id, companyId, type: "CLASS_2", isActive: true },
          select: { id: true },
        })
        if (!classification2) throw new Error("Sınıflandırma 2 kaydı bulunamadı")
      }
      if (normalizedAuthorizedUserId) {
        const member = await tx.userCompany.findFirst({
          where: { companyId, userId: normalizedAuthorizedUserId },
          select: { id: true },
        })
        if (!member) throw new Error("Seçilen çalışan bu firmaya ait değil")
      }

      const createdSupplier = await tx.supplier.create({
        data: {
          companyId,
          code,
          name,
          taxNumber,
          taxOffice,
          address,
          city,
          phone,
          email,
          contactPerson,
          paymentDueDays: parsePaymentDueDays(paymentDueDays),
          openingBalanceAmount: Number.isFinite(parsedOpeningBalanceAmount) ? parsedOpeningBalanceAmount : 0,
          openingBalanceType: parsedOpeningBalanceType,
          riskLimit: parsedRiskLimit,
          bankInfo: bankInfo ?? null,
          note: note ?? null,
          classification1Id: normalizedClassification1Id,
          classification2Id: normalizedClassification2Id,
          authorizedUserId: normalizedAuthorizedUserId,
          isAlsoCustomer: toBool(isAlsoCustomer),
        },
      })

      if (toBool(isAlsoCustomer)) {
        const linkedCustomer = await tx.customer.create({
          data: {
            companyId,
            code,
            name,
            taxNumber,
            taxOffice,
            address,
            city,
            phone,
            email,
            contactPerson,
            paymentDueDays: parsePaymentDueDays(paymentDueDays),
            openingBalanceAmount: Number.isFinite(parsedOpeningBalanceAmount) ? parsedOpeningBalanceAmount : 0,
            openingBalanceType: parsedOpeningBalanceType,
            riskLimit: parsedRiskLimit,
            bankInfo: bankInfo ?? null,
            note: note ?? null,
            classification1Id: normalizedClassification1Id,
            classification2Id: normalizedClassification2Id,
            authorizedUserId: normalizedAuthorizedUserId,
            isAlsoSupplier: true,
            linkedSupplierId: createdSupplier.id,
          },
        })

        return tx.supplier.update({
          where: { id: createdSupplier.id },
          data: { linkedCustomerId: linkedCustomer.id },
        })
      }

      return createdSupplier
    })

    return NextResponse.json(supplier, { status: 201 })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error creating supplier:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}


