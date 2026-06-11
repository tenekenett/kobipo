-- Cari (müşteri/tedarikçi) arşivleme desteği.
-- Arşivlenen kayıtlar listelerde görünmez ama veritabanında kalır (referans için).

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "customers_companyId_archivedAt_idx"
  ON "customers" ("companyId", "archivedAt");
CREATE INDEX IF NOT EXISTS "suppliers_companyId_archivedAt_idx"
  ON "suppliers" ("companyId", "archivedAt");
