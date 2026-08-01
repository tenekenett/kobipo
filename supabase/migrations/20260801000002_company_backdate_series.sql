-- Geçmiş tarihli e-belgeler için alternatif seri (numaratör) tanımı.
-- GİB kuralı: bir seri içinde belge numaraları tarih sırasını bozamaz. Ana seride
-- daha yeni tarihli bir belge varken geçmiş tarihli fatura gönderilirse Mysoft
-- "uygun alternatif belge numarası bulunamamıştır" hatası döner. Bu kolonlar, o
-- durumda otomatik olarak kullanılacak yedek serinin 3 harfli prefix'ini tutar.
-- Sadece hata alındığında devreye girer — normal faturalar ana seriden gider.
-- NULL = tanımlı değil (geçmiş tarihli gönderim hatayla kalır).
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS "eFaturaBackdatePrefix" text,
  ADD COLUMN IF NOT EXISTS "eArchiveBackdatePrefix" text;
