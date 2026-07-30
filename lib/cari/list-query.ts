/**
 * Cari liste sorgusu — bakiye hesabıyla birlikte.
 *
 * Bu dosya `app/api/cari/customers` ve `.../suppliers` route'larından ayıklandı.
 * Sebep: dışa aktarma da AYNI satırları ve AYNI bakiyeyi üretmek zorunda.
 * Sorgu route'un içinde kalsaydı export kendi SQL'ini yazacaktı ve iki bakiye
 * formülü zamanla birbirinden ayrılacaktı — kullanıcı ekranda bir tutar,
 * indirdiği Excel'de başka tutar görecekti.
 *
 * `paginate: false` (varsayılan) tüm satırları döndürür; export bunu kullanır.
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"

const LIST_CACHE_TTL_MS = 15000

type CacheEntry = { expiresAt: number; items: CariListRow[]; totalCount: number | null }
const listCache = new Map<string, CacheEntry>()

export type CariListRow = Record<string, unknown> & { id: string; name: string; balance: number }

export type CariListOptions = {
  companyId: string
  search?: string | null
  page?: number
  pageSize?: number
  /** `true` → LIMIT/OFFSET uygulanır ve `totalCount` hesaplanır. */
  paginate?: boolean
}

export type CariListResult = {
  items: CariListRow[]
  totalCount: number | null
  page: number
  pageSize: number
}

function normalize(options: CariListOptions) {
  const page = Number(options.page ?? 1)
  const pageSize = Number(options.pageSize ?? 50)
  const safePage = Number.isFinite(page) && page > 0 ? page : 1
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 200) : 50
  const search = (options.search || "").trim()
  return {
    paginate: Boolean(options.paginate),
    safePage,
    safePageSize,
    offset: (safePage - 1) * safePageSize,
    hasSearch: search.length > 0,
    searchLike: `%${search}%`,
  }
}

export async function fetchCustomerList(options: CariListOptions): Promise<CariListResult> {
  const { paginate, safePage, safePageSize, offset, hasSearch, searchLike } = normalize(options)
  const cacheKey = `customers|${options.companyId}|${searchLike}|${safePage}|${safePageSize}|${paginate ? "1" : "0"}`

  const now = Date.now()
  const cached = listCache.get(cacheKey)
  if (cached && cached.expiresAt > now) {
    return { items: cached.items, totalCount: cached.totalCount, page: safePage, pageSize: safePageSize }
  }

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      WITH filtered_customers AS (
        SELECT c.*
        FROM customers c
        WHERE c."companyId" = ${options.companyId}
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
        ${paginate ? Prisma.sql`LIMIT ${safePageSize} OFFSET ${offset}` : Prisma.empty}
      ),
      invoice_totals AS (
        SELECT i."customerId", SUM(i."totalAmount") AS total_amount_sum
        FROM invoices i
        INNER JOIN paged_customers pc ON pc.id = i."customerId"
        WHERE i.type = 'SALES'
          AND i.status NOT IN ('CANCELLED', 'CONVERTED')
        GROUP BY i."customerId"
      ),
      payment_totals AS (
        SELECT inv."customerId", SUM(ip.amount) AS payment_amount_sum
        FROM invoice_payments ip
        INNER JOIN invoices inv ON inv.id = ip."invoiceId"
        INNER JOIN paged_customers pc ON pc.id = inv."customerId"
        WHERE inv.type = 'SALES'
          AND inv.status NOT IN ('CANCELLED', 'CONVERTED')
          AND ip."transactionId" IS NULL
        GROUP BY inv."customerId"
      ),
      -- MAHSUP: bu müşteriye kayıtlı ALIŞ faturalarının ödenmemiş kısmı bizim ona
      -- borcumuzdur ve alacağı azaltır (aynı cari hem müşteri hem tedarikçi olabilir).
      -- Detay endpoint'iyle (customers/[id]) birebir aynı mantık.
      purchase_totals AS (
        SELECT i."customerId", SUM(i."totalAmount") AS total_amount_sum
        FROM invoices i
        INNER JOIN paged_customers pc ON pc.id = i."customerId"
        WHERE i.type = 'PURCHASE'
          AND i.status NOT IN ('CANCELLED', 'CONVERTED')
        GROUP BY i."customerId"
      ),
      purchase_payment_totals AS (
        SELECT inv."customerId", SUM(ip.amount) AS payment_amount_sum
        FROM invoice_payments ip
        INNER JOIN invoices inv ON inv.id = ip."invoiceId"
        INNER JOIN paged_customers pc ON pc.id = inv."customerId"
        WHERE inv.type = 'PURCHASE'
          AND inv.status NOT IN ('CANCELLED', 'CONVERTED')
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
        pc.slug,
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
        COALESCE(CAST(cn.amount_sum AS NUMERIC), 0) AS "checkNoteTotal",
        COALESCE(CAST(pu.total_amount_sum AS NUMERIC), 0) AS "purchaseTotal",
        COALESCE(CAST(pup.payment_amount_sum AS NUMERIC), 0) AS "purchasePaymentTotal"
      FROM paged_customers pc
      LEFT JOIN invoice_totals i ON i."customerId" = pc.id
      LEFT JOIN payment_totals p ON p."customerId" = pc.id
      LEFT JOIN purchase_totals pu ON pu."customerId" = pc.id
      LEFT JOIN purchase_payment_totals pup ON pup."customerId" = pc.id
      LEFT JOIN income_totals t_in ON t_in."customerId" = pc.id
      LEFT JOIN expense_totals t_ex ON t_ex."customerId" = pc.id
      LEFT JOIN check_note_totals cn ON cn."customerId" = pc.id
      ORDER BY pc.name ASC
    `),
    paginate
      ? prisma.$queryRaw<Array<{ total_count: bigint | number }>>(Prisma.sql`
          SELECT COUNT(*) AS total_count
          FROM customers c
          WHERE c."companyId" = ${options.companyId}
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

  const items = rows.map((row) => {
    const balance =
      Number(row.invoiceTotal || 0) -
      Number(row.paymentTotal || 0) -
      // Bu cariye kayıtlı alış faturalarının ödenmemiş kısmı (mahsup).
      (Number(row.purchaseTotal || 0) - Number(row.purchasePaymentTotal || 0)) +
      Number(row.expenseTotal || 0) -
      Number(row.incomeTotal || 0) -
      // Müşteriden alınan çek/senet (iade/protesto hariç) alacağı azaltır.
      Number(row.checkNoteTotal || 0) +
      (row.openingBalanceType === "CREDIT"
        ? -Number(row.openingBalanceAmount || 0)
        : Number(row.openingBalanceAmount || 0))

    const {
      invoiceTotal,
      paymentTotal,
      incomeTotal,
      expenseTotal,
      checkNoteTotal,
      purchaseTotal,
      purchasePaymentTotal,
      ...customer
    } = row
    return { ...customer, balance } as CariListRow
  })

  const totalCount = paginate ? Number(countRows[0]?.total_count || 0) : null
  listCache.set(cacheKey, { expiresAt: now + LIST_CACHE_TTL_MS, items, totalCount })
  return { items, totalCount, page: safePage, pageSize: safePageSize }
}

export async function fetchSupplierList(options: CariListOptions): Promise<CariListResult> {
  const { paginate, safePage, safePageSize, offset, hasSearch, searchLike } = normalize(options)
  const cacheKey = `suppliers|${options.companyId}|${searchLike}|${safePage}|${safePageSize}|${paginate ? "1" : "0"}`

  const now = Date.now()
  const cached = listCache.get(cacheKey)
  if (cached && cached.expiresAt > now) {
    return { items: cached.items, totalCount: cached.totalCount, page: safePage, pageSize: safePageSize }
  }

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      WITH filtered_suppliers AS (
        SELECT s.*
        FROM suppliers s
        WHERE s."companyId" = ${options.companyId}
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
        ${paginate ? Prisma.sql`LIMIT ${safePageSize} OFFSET ${offset}` : Prisma.empty}
      ),
      invoice_totals AS (
        SELECT i."supplierId", SUM(i."totalAmount") AS total_amount_sum
        FROM invoices i
        INNER JOIN paged_suppliers ps ON ps.id = i."supplierId"
        WHERE i.type = 'PURCHASE'
          AND i.status NOT IN ('CANCELLED', 'CONVERTED')
        GROUP BY i."supplierId"
      ),
      payment_totals AS (
        SELECT inv."supplierId", SUM(ip.amount) AS payment_amount_sum
        FROM invoice_payments ip
        INNER JOIN invoices inv ON inv.id = ip."invoiceId"
        INNER JOIN paged_suppliers ps ON ps.id = inv."supplierId"
        WHERE inv.type = 'PURCHASE'
          AND inv.status NOT IN ('CANCELLED', 'CONVERTED')
          AND ip."transactionId" IS NULL
        GROUP BY inv."supplierId"
      ),
      -- MAHSUP: bu tedarikçiye kayıtlı SATIŞ faturalarının tahsil edilmemiş kısmı
      -- onun bize borcudur ve bizim borcumuzu azaltır (detay endpoint'iyle aynı mantık).
      sales_totals AS (
        SELECT i."supplierId", SUM(i."totalAmount") AS total_amount_sum
        FROM invoices i
        INNER JOIN paged_suppliers ps ON ps.id = i."supplierId"
        WHERE i.type = 'SALES'
          AND i.status NOT IN ('CANCELLED', 'CONVERTED')
        GROUP BY i."supplierId"
      ),
      sales_payment_totals AS (
        SELECT inv."supplierId", SUM(ip.amount) AS payment_amount_sum
        FROM invoice_payments ip
        INNER JOIN invoices inv ON inv.id = ip."invoiceId"
        INNER JOIN paged_suppliers ps ON ps.id = inv."supplierId"
        WHERE inv.type = 'SALES'
          AND inv.status NOT IN ('CANCELLED', 'CONVERTED')
          AND ip."transactionId" IS NULL
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
      ),
      check_note_totals AS (
        -- Tedarikçide verilen (GIVEN/null) çek borcu azaltır (+); alınan (RECEIVED, iade) artırır (−).
        SELECT cn."supplierId", SUM(cn.amount) AS amount_sum
        FROM (
          SELECT ch."supplierId", (CASE WHEN ch.direction = 'RECEIVED' THEN -ch.amount ELSE ch.amount END) AS amount
          FROM checks ch
          WHERE ch.status NOT IN ('İADE_EDİLDİ', 'PROTESTOLU')
          UNION ALL
          SELECT n."supplierId", (CASE WHEN n.direction = 'RECEIVED' THEN -n.amount ELSE n.amount END) AS amount
          FROM promissory_notes n
          WHERE n.status NOT IN ('İADE_EDİLDİ', 'PROTESTOLU')
        ) cn
        INNER JOIN paged_suppliers ps ON ps.id = cn."supplierId"
        GROUP BY cn."supplierId"
      )
      SELECT
        ps.id,
        ps."companyId",
        ps.code,
        ps.slug,
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
        COALESCE(CAST(t_ex.amount_sum AS NUMERIC), 0) AS "expenseTotal",
        COALESCE(CAST(cn.amount_sum AS NUMERIC), 0) AS "checkNoteTotal",
        COALESCE(CAST(sa.total_amount_sum AS NUMERIC), 0) AS "salesTotal",
        COALESCE(CAST(sap.payment_amount_sum AS NUMERIC), 0) AS "salesPaymentTotal"
      FROM paged_suppliers ps
      LEFT JOIN invoice_totals i ON i."supplierId" = ps.id
      LEFT JOIN payment_totals p ON p."supplierId" = ps.id
      LEFT JOIN sales_totals sa ON sa."supplierId" = ps.id
      LEFT JOIN sales_payment_totals sap ON sap."supplierId" = ps.id
      LEFT JOIN income_totals t_in ON t_in."supplierId" = ps.id
      LEFT JOIN expense_totals t_ex ON t_ex."supplierId" = ps.id
      LEFT JOIN check_note_totals cn ON cn."supplierId" = ps.id
      ORDER BY ps.name ASC
    `),
    paginate
      ? prisma.$queryRaw<Array<{ total_count: bigint | number }>>(Prisma.sql`
          SELECT COUNT(*) AS total_count
          FROM suppliers s
          WHERE s."companyId" = ${options.companyId}
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

  const items = rows.map((row) => {
    // Tedarikçide ödeme (EXPENSE) borcu azaltır, tahsilat (INCOME) artırır —
    // müşteri formülünün simetriği (bkz. suppliers/[id]/route.ts).
    const balance =
      Number(row.invoiceTotal || 0) -
      Number(row.paymentTotal || 0) -
      // Bu cariye kayıtlı satış faturalarının tahsil edilmemiş kısmı (mahsup).
      (Number(row.salesTotal || 0) - Number(row.salesPaymentTotal || 0)) -
      Number(row.expenseTotal || 0) +
      Number(row.incomeTotal || 0) -
      // Tedarikçiye verilen çek/senet (iade/protesto hariç) borcumuzu azaltır.
      Number(row.checkNoteTotal || 0) +
      // Aynalı işaret (bkz. suppliers/[id]/route.ts): CREDIT (Alacak) bakiyeyi
      // artırır, DEBIT (Borç/avans) azaltır.
      (row.openingBalanceType === "CREDIT"
        ? Number(row.openingBalanceAmount || 0)
        : -Number(row.openingBalanceAmount || 0))

    const {
      invoiceTotal,
      paymentTotal,
      incomeTotal,
      expenseTotal,
      checkNoteTotal,
      salesTotal,
      salesPaymentTotal,
      ...supplier
    } = row
    return { ...supplier, balance } as CariListRow
  })

  const totalCount = paginate ? Number(countRows[0]?.total_count || 0) : null
  listCache.set(cacheKey, { expiresAt: now + LIST_CACHE_TTL_MS, items, totalCount })
  return { items, totalCount, page: safePage, pageSize: safePageSize }
}
