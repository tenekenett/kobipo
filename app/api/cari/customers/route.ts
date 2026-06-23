import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { toBool } from "@/lib/cari/repair-dual-role"
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

    const [customers, countRows] = await Promise.all([
      prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      WITH filtered_customers AS (
        SELECT c.*
        FROM customers c
        WHERE c."companyId" = ${companyId}
          AND c."archivedAt" IS NULL
          ${hasSearch
            ? Prisma.sql`AND (
              c.name ILIKE ${searchLike}
              OR c.code ILIKE ${searchLike}
              OR c."taxNumber" ILIKE ${searchLike}
              OR c.email ILIKE ${searchLike}
            )`
            : Prisma.empty}
      ),
      paged_customers AS (
        SELECT *
        FROM filtered_customers
        ORDER BY name ASC
        ${usePagination ? Prisma.sql`LIMIT ${safePageSize} OFFSET ${offset}` : Prisma.empty}
      ),
      invoice_totals AS (
        SELECT i."customerId", SUM(i."totalAmount") AS total_amount_sum
        FROM invoices i
        INNER JOIN paged_customers pc ON pc.id = i."customerId"
        WHERE i.type = 'SALES'
          AND i.status <> 'CANCELLED'
        GROUP BY i."customerId"
      ),
      payment_totals AS (
        SELECT inv."customerId", SUM(ip.amount) AS payment_amount_sum
        FROM invoice_payments ip
        INNER JOIN invoices inv ON inv.id = ip."invoiceId"
        INNER JOIN paged_customers pc ON pc.id = inv."customerId"
        WHERE inv.type = 'SALES'
          AND inv.status <> 'CANCELLED'
          AND ip."transactionId" IS NULL
        GROUP BY inv."customerId"
      ),
      income_totals AS (
        SELECT t."customerId", SUM(t.amount) AS amount_sum
        FROM transactions t
        INNER JOIN paged_customers pc ON pc.id = t."customerId"
        WHERE t.type = 'INCOME'
        GROUP BY t."customerId"
      ),
      expense_totals AS (
        SELECT t."customerId", SUM(t.amount) AS amount_sum
        FROM transactions t
        INNER JOIN paged_customers pc ON pc.id = t."customerId"
        WHERE t.type = 'EXPENSE'
        GROUP BY t."customerId"
      ),
      check_note_totals AS (
        -- Müşteride alınan (RECEIVED/null) çek alacağı azaltır (+); verilen (GIVEN, iade) artırır (−).
        SELECT cn."customerId", SUM(cn.amount) AS amount_sum
        FROM (
          SELECT ch."customerId", (CASE WHEN ch.direction = 'GIVEN' THEN -ch.amount ELSE ch.amount END) AS amount
          FROM checks ch
          WHERE ch.status NOT IN ('İADE_EDİLDİ', 'PROTESTOLU')
          UNION ALL
          SELECT n."customerId", (CASE WHEN n.direction = 'GIVEN' THEN -n.amount ELSE n.amount END) AS amount
          FROM promissory_notes n
          WHERE n.status NOT IN ('İADE_EDİLDİ', 'PROTESTOLU')
        ) cn
        INNER JOIN paged_customers pc ON pc.id = cn."customerId"
        GROUP BY cn."customerId"
      )
      SELECT
        pc.id,
        pc."companyId",
        pc.code,
        pc.name,
        pc."taxNumber",
        pc."taxOffice",
        pc.address,
        pc.city,
        pc.email,
        pc.phone,
        pc."contactPerson",
        pc."paymentDueDays",
        pc."openingBalanceAmount",
        pc."openingBalanceType",
        pc."riskLimit",
        pc."bankInfo",
        pc.note,
        pc."classification1Id",
        pc."classification2Id",
        pc."authorizedUserId",
        pc."isAlsoSupplier",
        pc."linkedSupplierId",
        pc."createdAt",
        pc."updatedAt",
        COALESCE(CAST(i.total_amount_sum AS NUMERIC), 0) AS "invoiceTotal",
        COALESCE(CAST(p.payment_amount_sum AS NUMERIC), 0) AS "paymentTotal",
        COALESCE(CAST(t_in.amount_sum AS NUMERIC), 0) AS "incomeTotal",
        COALESCE(CAST(t_ex.amount_sum AS NUMERIC), 0) AS "expenseTotal",
        COALESCE(CAST(cn.amount_sum AS NUMERIC), 0) AS "checkNoteTotal"
      FROM paged_customers pc
      LEFT JOIN invoice_totals i ON i."customerId" = pc.id
      LEFT JOIN payment_totals p ON p."customerId" = pc.id
      LEFT JOIN income_totals t_in ON t_in."customerId" = pc.id
      LEFT JOIN expense_totals t_ex ON t_ex."customerId" = pc.id
      LEFT JOIN check_note_totals cn ON cn."customerId" = pc.id
      ORDER BY pc.name ASC
    `),
      usePagination
        ? prisma.$queryRaw<Array<{ total_count: bigint | number }>>(Prisma.sql`
            SELECT COUNT(*) AS total_count
            FROM customers c
            WHERE c."companyId" = ${companyId}
            AND c."archivedAt" IS NULL
            ${hasSearch
              ? Prisma.sql`AND (
                c.name ILIKE ${searchLike}
                OR c.code ILIKE ${searchLike}
                OR c."taxNumber" ILIKE ${searchLike}
                OR c.email ILIKE ${searchLike}
              )`
              : Prisma.empty}
          `)
        : Promise.resolve([] as Array<{ total_count: bigint | number }>),
    ])

    const customersWithBalance = customers.map((row) => {
      const balance =
        Number(row.invoiceTotal || 0) -
        Number(row.paymentTotal || 0) +
        Number(row.expenseTotal || 0) -
        Number(row.incomeTotal || 0) -
        // Müşteriden alınan çek/senet (iade/protesto hariç) alacağı azaltır.
        Number(row.checkNoteTotal || 0) +
        (row.openingBalanceType === "CREDIT"
          ? -Number(row.openingBalanceAmount || 0)
          : Number(row.openingBalanceAmount || 0))

      const { invoiceTotal, paymentTotal, incomeTotal, expenseTotal, checkNoteTotal, ...customer } = row
      return {
        ...customer,
        balance,
      }
    })

    if (usePagination) {
      const totalCount = Number(countRows[0]?.total_count || 0)
      const payload = { items: customersWithBalance, totalCount, page: safePage, pageSize: safePageSize }
      listCache.set(cacheKey, { expiresAt: now + LIST_CACHE_TTL_MS, payload })
      return NextResponse.json(payload)
    }

    listCache.set(cacheKey, { expiresAt: now + LIST_CACHE_TTL_MS, payload: customersWithBalance })
    return NextResponse.json(customersWithBalance)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching customers:", error)
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
      district,
      phone,
      email,
      contactPerson,
      paymentDueDays,
      openingBalanceAmount,
      openingBalanceType,
      riskLimit,
      bankInfo,
      note,
      branches,
      classification1Id,
      classification2Id,
      authorizedUserId,
      isAlsoSupplier,
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
    const sanitizedBranches = Array.isArray(branches)
      ? branches
          .map((branch) => ({
            name: String(branch?.name || "").trim(),
            address: branch?.address ? String(branch.address).trim() : null,
          }))
          .filter((branch) => branch.name.length > 0)
      : []

    const customer = await prisma.$transaction(async (tx) => {
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

      const createdCustomer = await tx.customer.create({
        data: {
          companyId,
          code,
          name,
          taxNumber,
          taxOffice,
          address,
          city,
          district,
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
          isAlsoSupplier: toBool(isAlsoSupplier),
          branches:
            sanitizedBranches.length > 0
              ? {
                  createMany: {
                    data: sanitizedBranches,
                  },
                }
              : undefined,
        },
      })

      if (toBool(isAlsoSupplier)) {
        const linkedSupplier = await tx.supplier.create({
          data: {
            companyId,
            code,
            name,
            taxNumber,
            taxOffice,
            address,
            city,
            district,
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
            isAlsoCustomer: true,
            linkedCustomerId: createdCustomer.id,
          },
        })

        return tx.customer.update({
          where: { id: createdCustomer.id },
          data: { linkedSupplierId: linkedSupplier.id },
        })
      }

      return createdCustomer
    })

    return NextResponse.json(customer, { status: 201 })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error creating customer:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

