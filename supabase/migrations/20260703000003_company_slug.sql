-- SEF (okunabilir URL) — Company (firma / tenant) slug'ı.
-- Dashboard URL'lerindeki ?company=<cuid> yerine okunabilir ?company=<slug> için.
-- Diğer slug'lardan FARKI: Company üst-seviye olduğundan slug GLOBAL benzersizdir
-- (companyId ile scope'lanmaz). Kaynak: name. Desen: ADD COLUMN -> backfill (dedupe)
-- -> NOT NULL -> GLOBAL UNIQUE -> BEFORE INSERT trigger.

-- kobipo_slugify 20260703000002'de tanımlı; idempotent olması için burada da garanti et.
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

-- base slug'ını companies tablosu GENELİNDE benzersizleştirir (-2, -3, ...).
CREATE OR REPLACE FUNCTION kobipo_unique_company_slug(base text) RETURNS text AS $$
DECLARE root text; cand text; n int := 1; taken boolean;
BEGIN
  root := COALESCE(base, 'firma');
  cand := root;
  LOOP
    SELECT EXISTS(SELECT 1 FROM "companies" WHERE "slug" = cand) INTO taken;
    EXIT WHEN NOT taken;
    n := n + 1;
    cand := root || '-' || n;
  END LOOP;
  RETURN cand;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_company_slug() RETURNS trigger AS $$
BEGIN
  IF NEW."slug" IS NULL OR NEW."slug" = '' THEN
    NEW."slug" := kobipo_unique_company_slug(kobipo_slugify(NEW."name"));
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- ================================ COMPANIES ================================
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "slug" TEXT;
WITH base AS (
  SELECT "id", COALESCE(kobipo_slugify("name"), 'firma') AS b
  FROM "companies" WHERE "slug" IS NULL
),
ranked AS (
  SELECT "id", "b", ROW_NUMBER() OVER (PARTITION BY "b" ORDER BY "id") AS rn FROM base
)
UPDATE "companies" t SET "slug" = CASE WHEN r.rn = 1 THEN r."b" ELSE r."b" || '-' || r.rn END
FROM ranked r WHERE t."id" = r."id";
ALTER TABLE "companies" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "companies_slug_key" ON "companies" ("slug");
DROP TRIGGER IF EXISTS "trg_companies_slug" ON "companies";
CREATE TRIGGER "trg_companies_slug" BEFORE INSERT ON "companies" FOR EACH ROW EXECUTE FUNCTION set_company_slug();
