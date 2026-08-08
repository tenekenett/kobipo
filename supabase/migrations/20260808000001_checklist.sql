-- Açılış/kapanış kontrol listesi — patron maddeleri yazar, personel tikler.
--
-- BLOKLAMAZ: satış ekranı ve gün sonu raporu yalnız "şu maddeler onaylanmadı"
-- uyarısı basar. Sert kilit bilinçle reddedildi (gerekçe schema.prisma'da).
--
-- İki tablo: maddeler firmaya doğrudan bağlı (tür başına tek liste olduğu için
-- ayrı şablon satırı gereksizdi), tikler gün+madde kırılımında.

CREATE TABLE IF NOT EXISTS "checklist_items" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "type"      TEXT NOT NULL,
  "title"     VARCHAR(160) NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "checklist_items_companyId_type_idx"
  ON "checklist_items" ("companyId", "type");

CREATE TABLE IF NOT EXISTS "checklist_entries" (
  "id"           TEXT NOT NULL,
  "companyId"    TEXT NOT NULL,
  "itemId"       TEXT,
  -- Madde adı ve personel adı kopyalı: patron listeyi değiştirince geçmiş
  -- kayıtların "hangi maddeyi kim onayladı" cevabı bozulmasın.
  "itemTitle"    VARCHAR(160) NOT NULL,
  "employeeName" VARCHAR(160) NOT NULL,
  "type"         TEXT NOT NULL,
  -- Saatsiz gün: work_shifts."workDate" ile aynı gerekçe (TSİ 00:00–03:00
  -- arası kayıtların yanlış güne düşmesi).
  "workDate"     DATE NOT NULL,
  "employeeId"   TEXT,
  "note"         TEXT,
  "checkedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "checkedBy"    TEXT,
  CONSTRAINT "checklist_entries_pkey" PRIMARY KEY ("id")
);

-- Aynı madde aynı gün iki kez onaylanmasın. "itemId" NULL olan (maddesi
-- silinmiş) geçmiş kayıtlar Postgres'te bu kısıta takılmaz — istenen davranış.
CREATE UNIQUE INDEX IF NOT EXISTS "checklist_entries_companyId_itemId_workDate_key"
  ON "checklist_entries" ("companyId", "itemId", "workDate");

CREATE INDEX IF NOT EXISTS "checklist_entries_companyId_workDate_idx"
  ON "checklist_entries" ("companyId", "workDate");

CREATE INDEX IF NOT EXISTS "checklist_entries_employeeId_idx"
  ON "checklist_entries" ("employeeId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'checklist_items_companyId_fkey'
  ) THEN
    ALTER TABLE "checklist_items"
      ADD CONSTRAINT "checklist_items_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'checklist_entries_companyId_fkey'
  ) THEN
    ALTER TABLE "checklist_entries"
      ADD CONSTRAINT "checklist_entries_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- SET NULL: madde pasifleştirilmek yerine gerçekten silinse de günün tiki
  -- durur (adı kopyalı olduğu için raporda okunabilir kalır).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'checklist_entries_itemId_fkey'
  ) THEN
    ALTER TABLE "checklist_entries"
      ADD CONSTRAINT "checklist_entries_itemId_fkey"
      FOREIGN KEY ("itemId") REFERENCES "checklist_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- SET NULL: personel kartı silinse de onay kaydı durur.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'checklist_entries_employeeId_fkey'
  ) THEN
    ALTER TABLE "checklist_entries"
      ADD CONSTRAINT "checklist_entries_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
