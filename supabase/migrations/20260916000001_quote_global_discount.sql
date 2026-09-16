-- Teklif genel (teklif altı) iskontosu.
--
-- Faturada zaten var (invoices."globalDiscountAmount"); teklif faturaya dönüşünce
-- oraya taşınır. Teklifte ORAN da saklanır: teklif yeniden düzenlenen bir
-- belgedir ve kalemler değişince "%10" yüzde olarak kalmalı, ilk kayıttaki
-- tutara donmamalı. Oran NULL + tutar dolu = tutar olarak girilmiş iskonto.
--
-- Satır iskontosu için kolon eklenmedi: quote_items'ta discountRate/discountAmount
-- zaten var; tutar modu faturadaki kuralla (oran NULL + tutar dolu) ifade edilir.
--
-- Not: yeni TABLO eklenmediği için RLS dokunuşu gerekmiyor (quotes'ta RLS zaten
-- açık — bkz. 20260811000003_rls_lockdown.sql).

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS "globalDiscountRate" numeric(5, 2),
  ADD COLUMN IF NOT EXISTS "globalDiscountAmount" numeric(15, 2);
