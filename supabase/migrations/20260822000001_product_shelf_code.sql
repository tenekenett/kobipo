-- Ürün kartında raf numarası.
--
-- Ürünün depodaki fiziksel yeri (raf/koridor/göz): "A-04", "R12/3" gibi serbest
-- metin — her firma kendi raf şemasını kullandığı için doğrulanmaz. NULL = raf
-- bilgisi girilmemiş; mevcut ürünler etkilenmez.
--
-- Ürün bazındadır, depo bazlı DEĞİL: kart tek bir yer gösterir. Aynı ürün iki
-- depoda farklı raflarda duruyorsa doğru model warehouse_stocks üzerinde raf
-- tutmaktır; bu sütun o günü engellemez, kartın alanı olarak kalır.
--
-- Yeni TABLO eklenmediği için RLS adımı yok (CLAUDE.md "Yeni tablo → RLS açılacak"):
-- products tablosunun kilidi zaten yerinde.
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS "shelfCode" text;
