-- B9: EXPLAIN ANALYZE for the 5 heaviest queries hit by dashboards/lists.
-- Run inside Supabase SQL editor for the production database (read-only).
-- Replace :company_id with an actual companyId you want to test.
--
-- WHAT TO LOOK FOR
-- - "Index Scan" / "Bitmap Index Scan" on the matching @@index() defined in
--   prisma/schema.prisma (see supabase/migrations/20260427000001_perf_indexes.sql).
-- - Avoid "Seq Scan" on transactions / invoices / customers / suppliers / products.
-- - Total execution time should be in low milliseconds for the workloads we care
--   about (single-tenant filtered by companyId).
-- - "Buffers: shared hit=...": prefer hits over reads (cold cache shows reads).
--
-- HOW TO USE
-- 1. Open Supabase Dashboard -> Database -> SQL editor.
-- 2. Set the variable below or replace inline.
-- 3. Run each query block and inspect the plan.

\set company_id 'REPLACE_WITH_REAL_COMPANY_ID'

-- 1) Admin dashboard consolidated stats (lib/dashboard/admin-queries.ts :: getAdminStats)
--    Expects index hits on:
--      customers_companyId_idx, suppliers_companyId_idx,
--      products_companyId_idx, invoices_companyId_createdAt_idx (or invoices_companyId_status_idx),
--      transactions_companyId_type_date_idx (for income/expense filters).
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT
  (SELECT COUNT(*) FROM "customers" WHERE "companyId" = :'company_id') AS customer_count,
  (SELECT COUNT(*) FROM "suppliers" WHERE "companyId" = :'company_id') AS supplier_count,
  (SELECT COUNT(*) FROM "products"  WHERE "companyId" = :'company_id') AS product_count,
  (SELECT COUNT(*) FROM "invoices"  WHERE "companyId" = :'company_id') AS invoice_count,
  (SELECT COUNT(*) FROM "user_companies" WHERE "companyId" = :'company_id') AS user_count,
  (SELECT COALESCE(SUM(amount),0) FROM "transactions"
    WHERE "companyId" = :'company_id' AND "type" = 'INCOME')  AS income_total,
  (SELECT COALESCE(SUM(amount),0) FROM "transactions"
    WHERE "companyId" = :'company_id' AND "type" = 'EXPENSE') AS expense_total;

-- 2) Admin dashboard last 6 months cashflow (lib/dashboard/admin-queries.ts :: getMonthlyCashflow)
--    Expects index hit on transactions_companyId_date_idx.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT
  date_trunc('month', "date")::date AS month,
  SUM(CASE WHEN "type" = 'INCOME'  THEN amount ELSE 0 END) AS income,
  SUM(CASE WHEN "type" = 'EXPENSE' THEN amount ELSE 0 END) AS expense
FROM "transactions"
WHERE "companyId" = :'company_id'
  AND "date" >= (CURRENT_DATE - INTERVAL '6 months')
GROUP BY 1
ORDER BY 1 ASC;

-- 3) Recent invoices for dashboard (lib/dashboard/admin-queries.ts :: getRecentInvoices)
--    Expects index hit on invoices_companyId_createdAt_idx (DESC ordering).
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT id, "invoiceNo", status, "totalAmount", "customerId", "supplierId", "createdAt"
FROM "invoices"
WHERE "companyId" = :'company_id'
ORDER BY "createdAt" DESC
LIMIT 5;

-- 4) Finans transactions list (app/api/finans/transactions/route.ts)
--    Expects index hit on transactions_companyId_date_idx.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT id, "date", "type", amount, currency, description, reference,
       "accountId", "customerId", "supplierId"
FROM "transactions"
WHERE "companyId" = :'company_id'
ORDER BY "date" DESC
LIMIT 100;

-- 5) Cari list with search (app/api/cari/customers/route.ts)
--    Expects bitmap index scan on customers_companyId_idx; ILIKE will fall back
--    to seq filter inside the matching subset which is fine for typical sizes.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT *
FROM "customers"
WHERE "companyId" = :'company_id'
  AND (
    name ILIKE '%abc%' OR
    code ILIKE '%abc%' OR
    "taxNumber" ILIKE '%abc%'
  )
ORDER BY name ASC
LIMIT 200;

-- BONUS: Stock movements recent (used in stock dashboard)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT id, "productId", quantity, type, "createdAt"
FROM "stock_movements"
WHERE "companyId" = :'company_id'
ORDER BY "createdAt" DESC
LIMIT 10;
