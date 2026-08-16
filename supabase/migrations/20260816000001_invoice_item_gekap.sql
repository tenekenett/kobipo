-- GEKAP (Geri Kazanım Katılım Payı) — fatura kalemi maktu alanları.
--
-- GEKAP oran değil MAKTU'dur: birim başına sabit tutar (ör. ambalaj için kg,
-- lastik için adet başına). Bu yüzden mevcut otherTaxRate (%) alanlarıyla
-- modellenemez; kendi alanlarını alır.
--
--   gekapAmount = quantity * gekapUnitAmount
--
-- Satır iskontosundan da fatura altı iskontodan da ETKİLENMEZ. KDV matrahına
-- dahildir (KDVK 24/b, GİB özelgesi) — hesabın tek kaynağı lib/invoice/line-tax.ts.
--
-- Not: yeni TABLO eklenmediği için RLS dokunuşu gerekmiyor (invoice_items'ta
-- RLS zaten açık — bkz. 20260811000003_rls_lockdown.sql).

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS "gekapUnitAmount" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "gekapAmount" numeric(10, 2);
