-- Teklif kalemine SATIR TİPİ: fiyatlı kalem mi, bölüm ayırıcı mı.
--
-- "SECTION" satırı teklifi gruplayan başlıktır (description = başlık, note =
-- açıklama). Fiyatı yoktur, toplama girmez ve faturaya dönüşümde atlanır.
-- Ayrı tabloya alınmadı: sıra kalemlerle İÇ İÇEDİR ve tek `order` ekseninden
-- okunur — iki tabloda sıralama iki kaynaktan birleştirilmek zorunda kalırdı.
--
-- Varsayılan "ITEM": mevcut kalemlerin hepsi fiyatlı satırdır.
--
-- Not: yeni TABLO eklenmediği için RLS dokunuşu gerekmiyor (quote_items'ta RLS
-- zaten açık — bkz. 20260811000003_rls_lockdown.sql).

ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'ITEM';
