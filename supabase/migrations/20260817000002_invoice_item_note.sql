-- Fatura kalemine satır açıklaması (teklif kalemindekinin eşi).
--
-- description = mal/hizmet ADI (Mysoft invoiceDetail.productName). note = o adın
-- ALTINA basılan serbest metin; Mysoft invoiceDetail.note alanına gider (Swagger:
-- "Fatura kalemi için girmek istediğiniz not bilgisidir"). Açıklamayı description'a
-- yazmak GİB belgesindeki ürün adını kirletiyordu.
--
-- Tekliften faturaya dönüşümde quote_items.note → invoice_items.note taşınır
-- (bkz. 20260817000001_quote_item_note.sql).
--
-- Not: yeni TABLO eklenmediği için RLS dokunuşu gerekmiyor (invoice_items'ta RLS
-- zaten açık — bkz. 20260811000003_rls_lockdown.sql).

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS "note" text;
