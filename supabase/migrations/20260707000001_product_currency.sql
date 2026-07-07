-- Ürün fiyatının para birimi (TRY/USD/EUR). TRY dışıysa satış/teklif ekranlarında
-- güncel TCMB kuruyla belge para birimine çevrilir.

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "currency" VARCHAR(8) NOT NULL DEFAULT 'TRY';
