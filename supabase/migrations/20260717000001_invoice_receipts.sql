-- Fiş (hızlı satış/alış) desteği: invoices tablosuna "isReceipt" + "convertedInvoiceId".
-- Fiş = gayriresmî belge; ekonomik etki (stok, kasa, cari) fiş anında işler, GİB/e-belge
-- ve otomatik muhasebe fişi yoktur. Birden çok fiş tek resmî faturaya birleşir
-- (POST /api/fisler/faturaya-donustur): fişler status='CONVERTED' + convertedInvoiceId
-- ile işaretlenir, yerlerini konsolide fatura alır ve rapor/ekstrelerden düşerler.
-- Prisma şeması ana kaynaktır; bu dosya deploy edilen Supabase DB'yi hizalar (idempotent).

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS "isReceipt" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "convertedInvoiceId" text;

-- Fişin dönüştürüldüğü fatura (self-relation "ReceiptToInvoice").
-- Fatura silinirse fiş kaybolmaz, yalnızca bağ kopar (SET NULL).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'invoices_convertedInvoiceId_fkey'
  ) THEN
    ALTER TABLE public.invoices
    ADD CONSTRAINT "invoices_convertedInvoiceId_fkey"
    FOREIGN KEY ("convertedInvoiceId") REFERENCES public.invoices(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Fatura listeleri isReceipt=false, fiş listeleri isReceipt=true ile filtreler.
CREATE INDEX IF NOT EXISTS "invoices_companyId_isReceipt_idx"
  ON public.invoices ("companyId", "isReceipt");

-- Bir faturanın kaynak fişlerini (sourceReceipts) çekmek için.
CREATE INDEX IF NOT EXISTS "invoices_convertedInvoiceId_idx"
  ON public.invoices ("convertedInvoiceId");
