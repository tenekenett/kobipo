-- Ürün fotoğrafı (kafe/restoran menü kartları).
--
-- Public Supabase Storage nesnesinin tam URL'i (bucket: product-images). Satış ve
-- Adisyon ekranlarındaki menü ızgarası bu alanı doğrudan <img src> olarak basar;
-- yol yerine URL saklanmasının sebebi budur — private bucket + imzalı URL, her
-- kart için sunucuya uğramayı ve imza süresi dolunca tekrar uğramayı gerektirirdi.
-- NULL = fotoğraf yok (kart yalnız metin gösterir). Mevcut ürünler etkilenmez.
--
-- Yeni TABLO eklenmediği için RLS adımı yok (CLAUDE.md "Yeni tablo → RLS açılacak"):
-- products tablosunun kilidi zaten yerinde.
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS "imageUrl" text;
