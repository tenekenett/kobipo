ALTER TABLE public.customers
ADD COLUMN IF NOT EXISTS "openingBalanceAmount" numeric(14,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "openingBalanceType" text NOT NULL DEFAULT 'DEBIT';

ALTER TABLE public.suppliers
ADD COLUMN IF NOT EXISTS "openingBalanceAmount" numeric(14,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "openingBalanceType" text NOT NULL DEFAULT 'DEBIT';
