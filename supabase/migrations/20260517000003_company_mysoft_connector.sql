-- Mysoft müşteri hesabını tanımlayan connectorGuid + posta kutusu alias'ları.
-- /api/InvoiceOutbox/createInvoiceOutboxTestJson endpoint'inden çekilir ve
-- her fatura gönderiminde payload'a eklenir. Bu alanlar olmadan Mysoft
-- "Belge No için uygun numaratör bulunamadı" hatası verir.

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "eDonusumConnectorGuid" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "eDonusumPkAlias" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "eDonusumGbAlias" VARCHAR(255);
