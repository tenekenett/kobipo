-- Çek/senet → birden çok fatura bağı.
--
-- `invoiceId` tek alandı; bir çek üç faturayı kapatıyorsa ikisi yazılamıyordu.
-- Bağ BİLGİ amaçlıdır: cari bakiye çekin kendisinden düşer (list-query
-- check_note_totals), fatura açık tutarına InvoicePayment yazılmaz. `invoiceIds`
-- yeni kaynak; `invoiceId` listenin İLKİ olarak dolu tutulur (makbuz, detay ve
-- eski istemciler onu okuyor). Geçmiş kayıtlar tek elemanlı listeye taşınır.
--
-- Not: yeni TABLO eklenmediği için RLS dokunuşu gerekmiyor (checks ve
-- promissory_notes'ta RLS zaten açık — bkz. 20260811000003_rls_lockdown.sql).

ALTER TABLE public.checks
  ADD COLUMN IF NOT EXISTS "invoiceIds" text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.promissory_notes
  ADD COLUMN IF NOT EXISTS "invoiceIds" text[] NOT NULL DEFAULT '{}';

UPDATE public.checks
   SET "invoiceIds" = ARRAY["invoiceId"]
 WHERE "invoiceId" IS NOT NULL AND cardinality("invoiceIds") = 0;
UPDATE public.promissory_notes
   SET "invoiceIds" = ARRAY["invoiceId"]
 WHERE "invoiceId" IS NOT NULL AND cardinality("invoiceIds") = 0;
