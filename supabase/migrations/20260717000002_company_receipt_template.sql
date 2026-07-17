-- Fiş (hızlı satış/alış) tasarım şablonu: companies."receiptTemplate" (jsonb).
-- Firma başına tek şablon: logo (data URL), üst başlık, alt not, görünürlük
-- tercihleri (KDV dökümü / cari / not) ve kağıt genişliği (80|58 mm).
-- Şekil ve doğrulama: lib/fis/receipt-template.ts (normalizeReceiptTemplate).
-- NULL = şablon kaydedilmemiş → varsayılan (kodda sabit) fiş görünümü kullanılır.
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS "receiptTemplate" jsonb;
