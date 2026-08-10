-- Firmanın kendi tanımladığı roller.
--
-- NEDEN: hazır 6 enum rol (ADMIN/BRANCH_MANAGER/ACCOUNTANT/STOCK/SALES/VIEWER) her
-- işletmeye uymuyor. "Garson", "Kasiyer", "Depo sorumlusu" gibi roller işletmeden
-- işletmeye farklı sayfa kümesi ister. Enum ile bunu ifade etmenin tek yolu kişiyi
-- olduğundan geniş bir role koyup üstünden kısmaktı; artık firma rolü sıfırdan
-- tanımlayıp adını kendi koyuyor.
--
-- SINIR (önemli): hesap yönetimi sayfaları — Ekip Yönetimi, Şube Yönetimi, Abonelik,
-- Şube Müdürleri — özel role YAZILAMAZ; sunucu `assignablePages` ile eler. Devredilebilir
-- olsaydı bir özel rol sahibi kendi rolünü düzenleyip yetkisini sınırsıza çıkarabilirdi.
-- Bu dört ekran enum ADMIN'e bağlı kalır.

-- CUSTOM: yetkisi özel rolden gelen üyelikler bu enum değerini taşır. Enum'da
-- kalmasının sebebi, kodun geri kalanının (VIEWER salt-okunurluğu, ADMIN kontrolleri)
-- hâlâ enum üzerinden karar vermesi — CUSTOM "ne ADMIN ne VIEWER" anlamına gelir.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'CUSTOM';

CREATE TABLE IF NOT EXISTS "company_roles" (
  "id"            TEXT PRIMARY KEY,
  "companyId"     TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "description"   TEXT,
  "allowedPaths"  TEXT[] NOT NULL DEFAULT '{}',
  "writablePaths" TEXT[] NOT NULL DEFAULT '{}',
  "templateKey"   TEXT,
  "createdBy"     TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "company_roles_companyId_idx" ON "company_roles" ("companyId");

-- Aynı firmada iki rol aynı adı taşıyamaz: rol adı ekiplerde konuşulan bir etiket,
-- iki "Kasiyer" hangisinin ne yetkisi olduğunu belirsizleştirirdi.
CREATE UNIQUE INDEX IF NOT EXISTS "company_roles_companyId_name_key"
  ON "company_roles" ("companyId", "name");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_roles_companyId_fkey') THEN
    ALTER TABLE "company_roles"
      ADD CONSTRAINT "company_roles_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "user_companies"
  ADD COLUMN IF NOT EXISTS "customRoleId" TEXT;

CREATE INDEX IF NOT EXISTS "user_companies_customRoleId_idx"
  ON "user_companies" ("customRoleId");

-- SET NULL: rol silinirse üyelik ayakta kalır ama yetkisiz kalır (enum rolüne düşer).
-- CASCADE olsaydı rol silmek çalışanları firmadan atardı.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_companies_customRoleId_fkey') THEN
    ALTER TABLE "user_companies"
      ADD CONSTRAINT "user_companies_customRoleId_fkey"
      FOREIGN KEY ("customRoleId") REFERENCES "company_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
