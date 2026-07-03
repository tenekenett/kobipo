-- SEF (okunabilir URL) — Aşama 3: diğer detay modelleri.
-- products, invoices, quotes, employees, financial_accounts tablolarına slug ekler.
-- Kaynaklar: products/financial_accounts -> name, invoices -> invoiceNo,
-- quotes -> quoteNo, employees -> firstName + lastName.
-- Desen cari (20260703000001) ile aynı: ADD COLUMN -> backfill (dedupe) ->
-- NOT NULL -> firma-içi UNIQUE -> BEFORE INSERT trigger.

-- ============================ ORTAK YARDIMCILAR ============================
-- Türkçe-duyarlı, URL-güvenli slug üretir (boşsa NULL).
CREATE OR REPLACE FUNCTION kobipo_slugify(txt text) RETURNS text AS $$
  SELECT NULLIF(
    LEFT(
      TRIM(BOTH '-' FROM
        REGEXP_REPLACE(
          LOWER(TRANSLATE(COALESCE(txt, ''), 'ğĞüÜşŞıİöÖçÇ', 'gGuUsSiIoOcC')),
          '[^a-z0-9]+', '-', 'g'
        )
      ),
      80
    ),
  '');
$$ LANGUAGE sql IMMUTABLE;

-- base slug'ını verilen tablo + companyId kapsamında benzersizleştirir (-2, -3, ...).
CREATE OR REPLACE FUNCTION kobipo_unique_slug(tbl text, cid text, base text) RETURNS text AS $$
DECLARE root text; cand text; n int := 1; taken boolean;
BEGIN
  root := COALESCE(base, 'kayit');
  cand := root;
  LOOP
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I WHERE "companyId" = $1 AND "slug" = $2)', tbl)
      INTO taken USING cid, cand;
    EXIT WHEN NOT taken;
    n := n + 1;
    cand := root || '-' || n;
  END LOOP;
  RETURN cand;
END;
$$ LANGUAGE plpgsql;

-- Trigger fonksiyonları (kaynak kolona göre)
CREATE OR REPLACE FUNCTION set_slug_from_name() RETURNS trigger AS $$
BEGIN
  IF NEW."slug" IS NULL OR NEW."slug" = '' THEN
    NEW."slug" := kobipo_unique_slug(TG_TABLE_NAME, NEW."companyId", kobipo_slugify(NEW."name"));
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_slug_from_invoiceno() RETURNS trigger AS $$
BEGIN
  IF NEW."slug" IS NULL OR NEW."slug" = '' THEN
    NEW."slug" := kobipo_unique_slug(TG_TABLE_NAME, NEW."companyId", kobipo_slugify(NEW."invoiceNo"));
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_slug_from_quoteno() RETURNS trigger AS $$
BEGIN
  IF NEW."slug" IS NULL OR NEW."slug" = '' THEN
    NEW."slug" := kobipo_unique_slug(TG_TABLE_NAME, NEW."companyId", kobipo_slugify(NEW."quoteNo"));
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_slug_from_employee() RETURNS trigger AS $$
BEGIN
  IF NEW."slug" IS NULL OR NEW."slug" = '' THEN
    NEW."slug" := kobipo_unique_slug(TG_TABLE_NAME, NEW."companyId", kobipo_slugify(NEW."firstName" || ' ' || NEW."lastName"));
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- Verilen tabloya slug kolonu ekleyip backfill eden yardımcı (dedupe ile).
-- Her tablo için ayrı ayrı çağrılamaz (DDL); aşağıda tablo tablo yazıldı.

-- ================================ PRODUCTS ================================
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "slug" TEXT;
WITH base AS (
  SELECT "id", "companyId", COALESCE(kobipo_slugify("name"), 'kayit') AS b
  FROM "products" WHERE "slug" IS NULL
),
ranked AS (
  SELECT "id", "b", ROW_NUMBER() OVER (PARTITION BY "companyId", "b" ORDER BY "id") AS rn FROM base
)
UPDATE "products" t SET "slug" = CASE WHEN r.rn = 1 THEN r."b" ELSE r."b" || '-' || r.rn END
FROM ranked r WHERE t."id" = r."id";
ALTER TABLE "products" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "products_companyId_slug_key" ON "products" ("companyId", "slug");
DROP TRIGGER IF EXISTS "trg_products_slug" ON "products";
CREATE TRIGGER "trg_products_slug" BEFORE INSERT ON "products" FOR EACH ROW EXECUTE FUNCTION set_slug_from_name();

-- ============================ FINANCIAL_ACCOUNTS ============================
ALTER TABLE "financial_accounts" ADD COLUMN IF NOT EXISTS "slug" TEXT;
WITH base AS (
  SELECT "id", "companyId", COALESCE(kobipo_slugify("name"), 'kayit') AS b
  FROM "financial_accounts" WHERE "slug" IS NULL
),
ranked AS (
  SELECT "id", "b", ROW_NUMBER() OVER (PARTITION BY "companyId", "b" ORDER BY "id") AS rn FROM base
)
UPDATE "financial_accounts" t SET "slug" = CASE WHEN r.rn = 1 THEN r."b" ELSE r."b" || '-' || r.rn END
FROM ranked r WHERE t."id" = r."id";
ALTER TABLE "financial_accounts" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "financial_accounts_companyId_slug_key" ON "financial_accounts" ("companyId", "slug");
DROP TRIGGER IF EXISTS "trg_financial_accounts_slug" ON "financial_accounts";
CREATE TRIGGER "trg_financial_accounts_slug" BEFORE INSERT ON "financial_accounts" FOR EACH ROW EXECUTE FUNCTION set_slug_from_name();

-- ================================ INVOICES ================================
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "slug" TEXT;
WITH base AS (
  SELECT "id", "companyId", COALESCE(kobipo_slugify("invoiceNo"), 'fatura') AS b
  FROM "invoices" WHERE "slug" IS NULL
),
ranked AS (
  SELECT "id", "b", ROW_NUMBER() OVER (PARTITION BY "companyId", "b" ORDER BY "id") AS rn FROM base
)
UPDATE "invoices" t SET "slug" = CASE WHEN r.rn = 1 THEN r."b" ELSE r."b" || '-' || r.rn END
FROM ranked r WHERE t."id" = r."id";
ALTER TABLE "invoices" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_companyId_slug_key" ON "invoices" ("companyId", "slug");
DROP TRIGGER IF EXISTS "trg_invoices_slug" ON "invoices";
CREATE TRIGGER "trg_invoices_slug" BEFORE INSERT ON "invoices" FOR EACH ROW EXECUTE FUNCTION set_slug_from_invoiceno();

-- ================================= QUOTES =================================
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "slug" TEXT;
WITH base AS (
  SELECT "id", "companyId", COALESCE(kobipo_slugify("quoteNo"), 'teklif') AS b
  FROM "quotes" WHERE "slug" IS NULL
),
ranked AS (
  SELECT "id", "b", ROW_NUMBER() OVER (PARTITION BY "companyId", "b" ORDER BY "id") AS rn FROM base
)
UPDATE "quotes" t SET "slug" = CASE WHEN r.rn = 1 THEN r."b" ELSE r."b" || '-' || r.rn END
FROM ranked r WHERE t."id" = r."id";
ALTER TABLE "quotes" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "quotes_companyId_slug_key" ON "quotes" ("companyId", "slug");
DROP TRIGGER IF EXISTS "trg_quotes_slug" ON "quotes";
CREATE TRIGGER "trg_quotes_slug" BEFORE INSERT ON "quotes" FOR EACH ROW EXECUTE FUNCTION set_slug_from_quoteno();

-- ================================ EMPLOYEES ================================
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "slug" TEXT;
WITH base AS (
  SELECT "id", "companyId", COALESCE(kobipo_slugify("firstName" || ' ' || "lastName"), 'personel') AS b
  FROM "employees" WHERE "slug" IS NULL
),
ranked AS (
  SELECT "id", "b", ROW_NUMBER() OVER (PARTITION BY "companyId", "b" ORDER BY "id") AS rn FROM base
)
UPDATE "employees" t SET "slug" = CASE WHEN r.rn = 1 THEN r."b" ELSE r."b" || '-' || r.rn END
FROM ranked r WHERE t."id" = r."id";
ALTER TABLE "employees" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "employees_companyId_slug_key" ON "employees" ("companyId", "slug");
DROP TRIGGER IF EXISTS "trg_employees_slug" ON "employees";
CREATE TRIGGER "trg_employees_slug" BEFORE INSERT ON "employees" FOR EACH ROW EXECUTE FUNCTION set_slug_from_employee();
