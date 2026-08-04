-- Adisyon iptalinde sebep (docs/restoran/DENETIM-VE-TEMIZLIK.md — Faz 2 / İş 5).
--
-- Kalem iptalinde sebep zaten ZORUNLUydu; dolu bir adisyonu tek tıkla iptal etmek
-- sebepsizdi. İptal sayacı bugün "neden" sorusuna cevap veremiyor ve birleştirme
-- (mergedIntoId) dışındaki iptaller ayırt edilemiyordu.
--
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar.
-- Tamamen EKLEMELİ ve idempotent: mevcut kayıtlarda iki alan da NULL kalır
-- (geçmiş iptallerin sebebi bilinmiyor — uydurulmuyor).

ALTER TABLE public.restaurant_tickets
  ADD COLUMN IF NOT EXISTS "cancelReasonCode" varchar(30),
  ADD COLUMN IF NOT EXISTS "cancelReason" varchar(255);
