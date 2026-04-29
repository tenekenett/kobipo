ALTER TABLE public.customers
ADD COLUMN IF NOT EXISTS "riskLimit" numeric(14,2),
ADD COLUMN IF NOT EXISTS "bankInfo" text,
ADD COLUMN IF NOT EXISTS "note" text;

ALTER TABLE public.suppliers
ADD COLUMN IF NOT EXISTS "riskLimit" numeric(14,2),
ADD COLUMN IF NOT EXISTS "bankInfo" text,
ADD COLUMN IF NOT EXISTS "note" text;

CREATE TABLE IF NOT EXISTS public.customer_branches (
  id text PRIMARY KEY,
  "customerId" text NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_branches_customerId_idx ON public.customer_branches("customerId");
