-- İndirim kodu sadeleştirmesi: TAVAN ve ASGARİ TUTAR kaldırıldı.
--
-- 20260826000001'de kodun üç ayarı vardı: indirim değeri, yüzde indirimde tavan
-- (`maxDiscount`) ve asgari sipariş tutarı (`minAmount`). Pratikte kupon "şu kadar
-- indirim" demekten ibaret; iki ek sınır hem panelde hem kural motorunda ekstra
-- durum üretiyordu (aynı kod bir pakette geçerli, diğerinde değil). Kaldırıldılar.
--
-- Kalan sınırlar aynen duruyor: kapsam (kontör/abonelik), tarih aralığı, toplam ve
-- firma başına kullanım hakkı, yenilemede geçerlilik, aktif/pasif.
--
-- Veri kaybı: bu iki sütundaki değerler silinir. Kolonlar dünden beri var ve
-- üretimde kullanılmadılar (yalnız test kodları taşıyordu).
--
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

ALTER TABLE public.discount_codes
  DROP COLUMN IF EXISTS "maxDiscount",
  DROP COLUMN IF EXISTS "minAmount";
