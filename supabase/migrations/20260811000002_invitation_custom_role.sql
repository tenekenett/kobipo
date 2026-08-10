-- Davetin özel rol taşıması.
--
-- NEDEN: rol tanımlama eklendi ama davet akışı hâlâ yalnız enum rol taşıyordu. Yani
-- yönetici çalışanı eklerken kendi tanımladığı rolü SEÇEMİYOR, kişi hazır bir rolle
-- (çoğu zaman olduğundan geniş) giriyor ve ancak sonradan düzeltiliyordu. Arada kalan
-- sürede çalışan kendisine hiç verilmemiş yetkilerle dolaşıyor.
--
-- SET NULL: rol silinirse bekleyen davet iptal olmaz, enum rolüyle kabul edilir.

ALTER TABLE "company_invitations"
  ADD COLUMN IF NOT EXISTS "customRoleId" TEXT;

CREATE INDEX IF NOT EXISTS "company_invitations_customRoleId_idx"
  ON "company_invitations" ("customRoleId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_invitations_customRoleId_fkey'
  ) THEN
    ALTER TABLE "company_invitations"
      ADD CONSTRAINT "company_invitations_customRoleId_fkey"
      FOREIGN KEY ("customRoleId") REFERENCES "company_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
