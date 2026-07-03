-- SEF (okunabilir URL) çalışması — Aşama 1 (cari dilimi).
-- customers ve suppliers tablolarına, ham cuid yerine URL'de kullanılacak
-- okunabilir "slug" kolonu ekler. Slug, isimden üretilir (Türkçe karakterler
-- sadeleştirilir) ve firma içinde benzersiz olacak şekilde tekilleştirilir.
--
-- Sıra: kolonu ekle (nullable) -> backfill (dedupe) -> NOT NULL -> firma-içi
-- UNIQUE index. Mevcut Prisma client bu kolonu bilmediği için uygulanması
-- çalışan uygulamayı ETKİLEMEZ; kod tarafı sonraki aşamada bağlanır.

-- =============================== CUSTOMERS ===============================
ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "slug" TEXT;

WITH base AS (
  SELECT
    "id",
    "companyId",
    COALESCE(NULLIF(
      LEFT(
        TRIM(BOTH '-' FROM
          REGEXP_REPLACE(
            LOWER(TRANSLATE("name", 'ğĞüÜşŞıİöÖçÇ', 'gGuUsSiIoOcC')),
            '[^a-z0-9]+', '-', 'g'
          )
        ),
        80
      ),
    ''), 'kayit') AS b
  FROM "customers"
  WHERE "slug" IS NULL
),
ranked AS (
  SELECT
    "id",
    "b",
    ROW_NUMBER() OVER (PARTITION BY "companyId", "b" ORDER BY "id") AS rn
  FROM base
)
UPDATE "customers" c
SET "slug" = CASE WHEN r.rn = 1 THEN r."b" ELSE r."b" || '-' || r.rn END
FROM ranked r
WHERE c."id" = r."id";

ALTER TABLE "customers"
  ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "customers_companyId_slug_key"
  ON "customers" ("companyId", "slug");

-- =============================== SUPPLIERS ===============================
ALTER TABLE "suppliers"
  ADD COLUMN IF NOT EXISTS "slug" TEXT;

WITH base AS (
  SELECT
    "id",
    "companyId",
    COALESCE(NULLIF(
      LEFT(
        TRIM(BOTH '-' FROM
          REGEXP_REPLACE(
            LOWER(TRANSLATE("name", 'ğĞüÜşŞıİöÖçÇ', 'gGuUsSiIoOcC')),
            '[^a-z0-9]+', '-', 'g'
          )
        ),
        80
      ),
    ''), 'kayit') AS b
  FROM "suppliers"
  WHERE "slug" IS NULL
),
ranked AS (
  SELECT
    "id",
    "b",
    ROW_NUMBER() OVER (PARTITION BY "companyId", "b" ORDER BY "id") AS rn
  FROM base
)
UPDATE "suppliers" s
SET "slug" = CASE WHEN r.rn = 1 THEN r."b" ELSE r."b" || '-' || r.rn END
FROM ranked r
WHERE s."id" = r."id";

ALTER TABLE "suppliers"
  ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "suppliers_companyId_slug_key"
  ON "suppliers" ("companyId", "slug");

-- =============================== SLUG TRIGGER ===============================
-- Yeni kayıtlarda (INSERT) slug boş/NULL ise isimden otomatik üretir; firma
-- içinde benzersiz olacak şekilde sonek ekler. Generic: name + companyId + slug
-- kolonlarına sahip her tabloya bağlanabilir (customers, suppliers, products,
-- financial_accounts ...). App create çağrıları slug göndermez; Prisma @default("")
-- ile "" gönderir, trigger bunu gerçek slug ile değiştirir.
CREATE OR REPLACE FUNCTION set_entity_slug() RETURNS trigger AS $$
DECLARE
  base text;
  cand text;
  n int := 1;
  taken boolean;
BEGIN
  IF NEW."slug" IS NOT NULL AND NEW."slug" <> '' THEN
    RETURN NEW;
  END IF;
  base := NULLIF(
    LEFT(
      TRIM(BOTH '-' FROM
        REGEXP_REPLACE(
          LOWER(TRANSLATE(NEW."name", 'ğĞüÜşŞıİöÖçÇ', 'gGuUsSiIoOcC')),
          '[^a-z0-9]+', '-', 'g'
        )
      ),
      80
    ),
  '');
  IF base IS NULL THEN base := 'kayit'; END IF;
  cand := base;
  LOOP
    EXECUTE format(
      'SELECT EXISTS(SELECT 1 FROM %I WHERE "companyId" = $1 AND "slug" = $2)',
      TG_TABLE_NAME
    ) INTO taken USING NEW."companyId", cand;
    EXIT WHEN NOT taken;
    n := n + 1;
    cand := base || '-' || n;
  END LOOP;
  NEW."slug" := cand;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_customers_slug" ON "customers";
CREATE TRIGGER "trg_customers_slug"
  BEFORE INSERT ON "customers"
  FOR EACH ROW EXECUTE FUNCTION set_entity_slug();

DROP TRIGGER IF EXISTS "trg_suppliers_slug" ON "suppliers";
CREATE TRIGGER "trg_suppliers_slug"
  BEFORE INSERT ON "suppliers"
  FOR EACH ROW EXECUTE FUNCTION set_entity_slug();
