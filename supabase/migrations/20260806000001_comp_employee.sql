-- İkramı VEREN personel — iki uçtan da kaydedilir.
-- Kararlar: docs/restoran/SATIS-EKRANI.md K3.2 (K3.1'in ikram karşılığı)
--
-- İkramın TUTARI ve MALZEMESİ zaten ölçülüyordu, SORUMLUSU ölçülmüyordu: ekranda
-- yetkisi olan herkes sınırsız ikram verebiliyor ve hiçbir raporda kimin verdiği
-- görünmüyordu. İskontoda 2026-08-06'da kapatılan açığın ikram tarafındaki eşi.
--
-- Neden İKİ tablo: adisyonda ikram kalem işaretlenirken (saatler önce) belirlenir
-- ve kapanışa kadar yaşamalıdır → kalemde durur. Tezgâhta (Kahveci Satış) sepetin
-- adisyonu YOKTUR; ikramın tek kalıcı izi stok düzeltmesidir → harekette durur.
-- Adisyon kapanışında kalemdeki personel harekete de taşınır, böylece "bu ay kim
-- ne kadar ikram etti" sorusu TEK yerden (stock_movements) cevaplanabilir.
--
-- Ekleme; mevcut satırlar NULL kalır (geçmiş ikramların sorumlusu bilinmiyor).

ALTER TABLE "restaurant_ticket_items"
  ADD COLUMN IF NOT EXISTS "compEmployeeId" TEXT;

ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "employeeId" TEXT;

CREATE INDEX IF NOT EXISTS "restaurant_ticket_items_compEmployeeId_idx"
  ON "restaurant_ticket_items" ("compEmployeeId");

CREATE INDEX IF NOT EXISTS "stock_movements_employeeId_idx"
  ON "stock_movements" ("employeeId");

-- SET NULL: personel kartı silinse de ikram kaydı (ve stok hareketi) durur —
-- kaydın kendisi maliyet taşıyor, sorumlusunun silinmesi onu yok saydıramaz.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_ticket_items_compEmployeeId_fkey'
  ) THEN
    ALTER TABLE "restaurant_ticket_items"
      ADD CONSTRAINT "restaurant_ticket_items_compEmployeeId_fkey"
      FOREIGN KEY ("compEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_employeeId_fkey'
  ) THEN
    ALTER TABLE "stock_movements"
      ADD CONSTRAINT "stock_movements_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
