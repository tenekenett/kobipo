-- Satış/adisyon ekranı yenilemesi (docs/restoran/SATIS-EKRANI.md)
--   1) Adisyon kalemine akıbet (ikram / zayi / iptal) + sebep + seçilen seçenekler
--   2) Adisyona hesap iskontosu
--   3) Ürün seçenekleri (porsiyon/modifier): grup + şık
-- Hepsi EKLEME; mevcut kolon/tablo değişmiyor. Idempotent.

-- 1) Adisyon kalemi -----------------------------------------------------------
ALTER TABLE "restaurant_ticket_items"
  ADD COLUMN IF NOT EXISTS "status"     VARCHAR(10) NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN IF NOT EXISTS "reasonCode" VARCHAR(30),
  ADD COLUMN IF NOT EXISTS "reason"     VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "options"    JSONB;

-- 2) Adisyon iskontosu --------------------------------------------------------
ALTER TABLE "restaurant_tickets"
  ADD COLUMN IF NOT EXISTS "discountType"   VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "discountValue"  DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS "discountReason" VARCHAR(255);

-- 3) Ürün seçenekleri ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS "product_option_groups" (
  "id"         TEXT PRIMARY KEY,
  "companyId"  TEXT NOT NULL,
  "productId"  TEXT NOT NULL,
  "name"       VARCHAR(80) NOT NULL,
  "isRequired" BOOLEAN NOT NULL DEFAULT false,
  "isMulti"    BOOLEAN NOT NULL DEFAULT false,
  "order"      INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_option_groups_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE,
  CONSTRAINT "product_option_groups_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "product_option_groups_companyId_idx" ON "product_option_groups"("companyId");
CREATE INDEX IF NOT EXISTS "product_option_groups_productId_idx" ON "product_option_groups"("productId");

CREATE TABLE IF NOT EXISTS "product_options" (
  "id"         TEXT PRIMARY KEY,
  "groupId"    TEXT NOT NULL,
  "name"       VARCHAR(80) NOT NULL,
  "priceDelta" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "isDefault"  BOOLEAN NOT NULL DEFAULT false,
  "order"      INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_options_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "product_option_groups"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "product_options_groupId_idx" ON "product_options"("groupId");
