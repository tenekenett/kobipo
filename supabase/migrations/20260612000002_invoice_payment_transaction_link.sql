-- Cari ekranından girilen tahsilat/ödeme (Transaction) ile faturaya yazılan
-- ödeme (InvoicePayment) arasında bağ. "Çift yazım" modelinde tek tahsilat hem
-- kasa işlemi hem fatura ödemesi olarak tutulur; bu kolon ikisini ilişkilendirir.
-- Bağlı işlem silinince ödeme de silinir (ON DELETE CASCADE).

ALTER TABLE "invoice_payments"
  ADD COLUMN IF NOT EXISTS "transactionId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoice_payments_transactionId_fkey'
  ) THEN
    ALTER TABLE "invoice_payments"
      ADD CONSTRAINT "invoice_payments_transactionId_fkey"
      FOREIGN KEY ("transactionId") REFERENCES "transactions"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "invoice_payments_transactionId_idx"
  ON "invoice_payments" ("transactionId");
