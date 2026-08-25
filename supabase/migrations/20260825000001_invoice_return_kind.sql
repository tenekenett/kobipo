-- İade faturası: yön + iade edilen asıl faturaya atıf.
--
-- ÖNCESİ: `invoices.type = 'RETURN'` TEK yönlüydü — stok her zaman GİRER, karşı
-- taraf her zaman müşteri sayılırdı (satış iadesi). Tedarikçiye mal geri
-- gönderip ona iade faturası kesmek (alış iadesi) hiç mümkün değildi: tek `type`
-- sütunu iki zıt stok yönünü taşıyamaz.
--
-- `returnKind`:
--   'SALES'    → satış iadesi: müşteri geri verdi, stok GİRER,  karşı taraf müşteri
--   'PURCHASE' → alış iadesi:  tedarikçiye verdik, stok ÇIKAR,  karşı taraf tedarikçi
--   NULL       → satış iadesi (bu sütundan ÖNCE kesilmiş iadeler). Geriye dönük
--                doldurma YAPILMAZ: NULL'ı satış iadesi saymak eski davranışı
--                birebir korur, UPDATE ise duran belgelerin stok geçmişiyle
--                çelişebilir.
--
-- Atıf alanları e-belge zorunluluğudur: Mysoft `billingRefInvoiceList`
-- (UBL cac:BillingReference) alanını invoiceType=IADE/TEVKIFATIADE'de bekler.
-- `returnOfInvoiceId` Kobipo'daki belgeye bağlar; no/tarih AYRICA saklanır çünkü
-- asıl fatura sistemde olmayabilir (elden gelen kâğıt fatura) ve e-belgeye giden
-- değer bu ikisidir.
--
-- Yeni TABLO eklenmediği için RLS adımı yok (CLAUDE.md "Yeni tablo → RLS
-- açılacak"): invoices tablosunun kilidi zaten yerinde.
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS "returnKind"           text,
  ADD COLUMN IF NOT EXISTS "returnOfInvoiceId"    text,
  ADD COLUMN IF NOT EXISTS "returnRefInvoiceNo"   text,
  ADD COLUMN IF NOT EXISTS "returnRefInvoiceDate" timestamp(3) without time zone,
  ADD COLUMN IF NOT EXISTS "returnRefNote"        text;

CREATE INDEX IF NOT EXISTS "invoices_returnOfInvoiceId_idx"
  ON public.invoices ("returnOfInvoiceId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_returnOfInvoiceId_fkey'
  ) THEN
    -- SetNull: asıl fatura silinse bile iade belgesi ayakta kalmalı — e-belge
    -- çoktan GİB'e gitmiş olabilir ve no/tarih ayrı sütunlarda duruyor.
    ALTER TABLE public.invoices
      ADD CONSTRAINT "invoices_returnOfInvoiceId_fkey"
      FOREIGN KEY ("returnOfInvoiceId") REFERENCES public.invoices (id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
