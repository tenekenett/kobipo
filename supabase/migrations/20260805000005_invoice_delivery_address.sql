-- Faturada sevk adresi (malın teslim edileceği yer).
--
-- Mysoft fatura modeli (InvoiceOutboxModel) teslim tarafında yalnızca il/ilçe/ülke
-- kabul eder (deliveryCity, deliveryCitySubdivisionName, deliveryCountry); açık adres
-- alanları faturada yoktur (yalnız alıcı ve gönderen-şube altında). Bu yüzden
-- "deliveryAddress" e-belgeye gitmez, Kobipo arayüzü/çıktıları içindir.
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS "deliveryAddress"  text,
  ADD COLUMN IF NOT EXISTS "deliveryDistrict" text,
  ADD COLUMN IF NOT EXISTS "deliveryCity"     text,
  ADD COLUMN IF NOT EXISTS "deliveryCountry"  text;
