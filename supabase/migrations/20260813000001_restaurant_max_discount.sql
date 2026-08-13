-- Restoran & Kafe iskonto tavanı (Company.restaurantMaxDiscountPercent).
--
-- Bir hesaba verilebilecek EN YÜKSEK indirim, yüzde olarak. Yalnız "yüzde"
-- iskontoyu değil tutar iskontosunu da bağlar: 600 ₺'lik hesaba 500 ₺ indirim
-- %83'tür ve tavan ikisini de aynı orandan ölçer (lib/restoran/discount-limit.ts).
--
-- NULL = sınır yok — bugüne kadarki davranış, mevcut firmalar etkilenmez.
-- 0    = iskonto tamamen kapalı. İkisi FARKLI durumlardır; kolon bu yüzden
--        NOT NULL DEFAULT 0 değil, nullable tanımlandı.
--
-- Yeni TABLO eklenmediği için RLS adımı yok (CLAUDE.md "Yeni tablo → RLS
-- açılacak"): companies tablosunun kilidi zaten yerinde.
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS "restaurantMaxDiscountPercent" numeric(5, 2);
