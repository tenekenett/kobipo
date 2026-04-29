-- Performance indexes for dashboard / list queries (A5)
-- Use IF NOT EXISTS so re-runs are safe.
-- For very large tables, run CONCURRENTLY versions manually via Supabase SQL editor.

-- accounts / sessions (NextAuth)
CREATE INDEX IF NOT EXISTS "accounts_userId_idx" ON "accounts"("userId");
CREATE INDEX IF NOT EXISTS "sessions_userId_idx" ON "sessions"("userId");

-- customers / suppliers / products
CREATE INDEX IF NOT EXISTS "customers_companyId_idx" ON "customers"("companyId");
CREATE INDEX IF NOT EXISTS "suppliers_companyId_idx" ON "suppliers"("companyId");
CREATE INDEX IF NOT EXISTS "products_companyId_idx" ON "products"("companyId");

-- financial_accounts
CREATE INDEX IF NOT EXISTS "financial_accounts_companyId_idx" ON "financial_accounts"("companyId");

-- stock_movements
CREATE INDEX IF NOT EXISTS "stock_movements_productId_idx" ON "stock_movements"("productId");
CREATE INDEX IF NOT EXISTS "stock_movements_companyId_createdAt_idx" ON "stock_movements"("companyId", "createdAt");

-- transactions: most aggregations and lists go through these
CREATE INDEX IF NOT EXISTS "transactions_companyId_date_idx" ON "transactions"("companyId", "date");
CREATE INDEX IF NOT EXISTS "transactions_companyId_type_date_idx" ON "transactions"("companyId", "type", "date");
CREATE INDEX IF NOT EXISTS "transactions_accountId_idx" ON "transactions"("accountId");
CREATE INDEX IF NOT EXISTS "transactions_customerId_idx" ON "transactions"("customerId");
CREATE INDEX IF NOT EXISTS "transactions_supplierId_idx" ON "transactions"("supplierId");

-- invoices
CREATE INDEX IF NOT EXISTS "invoices_companyId_createdAt_idx" ON "invoices"("companyId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "invoices_companyId_status_idx" ON "invoices"("companyId", "status");
CREATE INDEX IF NOT EXISTS "invoices_customerId_idx" ON "invoices"("customerId");
CREATE INDEX IF NOT EXISTS "invoices_supplierId_idx" ON "invoices"("supplierId");

-- invoice_items / quote_items (FK joins on detail pages)
CREATE INDEX IF NOT EXISTS "invoice_items_invoiceId_idx" ON "invoice_items"("invoiceId");
CREATE INDEX IF NOT EXISTS "invoice_items_productId_idx" ON "invoice_items"("productId");
CREATE INDEX IF NOT EXISTS "quote_items_quoteId_idx" ON "quote_items"("quoteId");
CREATE INDEX IF NOT EXISTS "quote_items_productId_idx" ON "quote_items"("productId");
