-- Seçeneğin REÇETEYE etkisi (docs/restoran/SATIS-EKRANI.md K6).
--
-- Bugüne kadar seçenek yalnız FİYATI değiştiriyordu: soya sütlü latte satılınca
-- stoktan inek sütü düşüyordu. Üç mod ekleniyor:
--   SWAP → reçetedeki bileşenin yerine başkası düşer (boş hedef = hiç düşmez)
--   ADD  → reçeteye ek malzeme düşer ("ekstra shot")
--   recipeFactor → reçetenin tamamı ölçeklenir ("büyük boy" = 1.5)
--
-- Hepsi EKLEME ve NULL kabul eder; mevcut seçenekler etkisiz kalır. Idempotent.

ALTER TABLE "product_options"
  ADD COLUMN IF NOT EXISTS "effectMode"     VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "fromProductId"  TEXT,
  ADD COLUMN IF NOT EXISTS "toProductId"    TEXT,
  ADD COLUMN IF NOT EXISTS "effectQuantity" DECIMAL(14, 4),
  ADD COLUMN IF NOT EXISTS "effectUnit"     VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "recipeFactor"   DECIMAL(6, 3);

-- ON DELETE SET NULL: hammadde kartı silinirse seçenek (ve menü) ayakta kalır;
-- yarım kalan etki genişletmede sessizce atlanır.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_options_fromProductId_fkey'
  ) THEN
    ALTER TABLE "product_options"
      ADD CONSTRAINT "product_options_fromProductId_fkey"
      FOREIGN KEY ("fromProductId") REFERENCES "products"("id") ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_options_toProductId_fkey'
  ) THEN
    ALTER TABLE "product_options"
      ADD CONSTRAINT "product_options_toProductId_fkey"
      FOREIGN KEY ("toProductId") REFERENCES "products"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "product_options_fromProductId_idx" ON "product_options"("fromProductId");
CREATE INDEX IF NOT EXISTS "product_options_toProductId_idx" ON "product_options"("toProductId");
