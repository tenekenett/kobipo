CREATE INDEX IF NOT EXISTS "customers_companyId_name_idx"
ON "customers" ("companyId", "name");

CREATE INDEX IF NOT EXISTS "suppliers_companyId_name_idx"
ON "suppliers" ("companyId", "name");

CREATE INDEX IF NOT EXISTS "transactions_companyId_type_customerId_idx"
ON "transactions" ("companyId", "type", "customerId");

CREATE INDEX IF NOT EXISTS "transactions_companyId_type_supplierId_idx"
ON "transactions" ("companyId", "type", "supplierId");

CREATE INDEX IF NOT EXISTS "invoices_companyId_type_customerId_idx"
ON "invoices" ("companyId", "type", "customerId");

CREATE INDEX IF NOT EXISTS "invoices_companyId_type_supplierId_idx"
ON "invoices" ("companyId", "type", "supplierId");
