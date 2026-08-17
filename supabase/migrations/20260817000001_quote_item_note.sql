-- Teklif kalemine satır açıklaması.
--
-- description ürünün adıdır (ProductCombobox'tan gelir, faturaya dönüşümde
-- fatura kalemi açıklaması olarak taşınır). Ölçü/teslim koşulu/model detayı gibi
-- serbest metni oraya yazmak ürün adını kirletir → ayrı alan.
--
-- Not: yeni TABLO eklenmediği için RLS dokunuşu gerekmiyor (quote_items'ta RLS
-- zaten açık — bkz. 20260811000003_rls_lockdown.sql).

ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS "note" text;
