-- Add separate prefix columns for e-Fatura and e-Arşiv on the Company table.
-- Keeps the existing `invoiceSeriesPrefix` (used for internal invoice numbering)
-- and adds two new optional columns that drive the prefix sent to Mysoft.

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "eFaturaPrefix"  VARCHAR(3),
  ADD COLUMN IF NOT EXISTS "eArchivePrefix" VARCHAR(3);
