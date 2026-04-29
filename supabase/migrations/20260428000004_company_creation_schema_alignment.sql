DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EDonusumIntegrator') THEN
    CREATE TYPE "EDonusumIntegrator" AS ENUM ('GIB_PORTAL', 'OZEL_ENTEGRATOR');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.plans (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  "monthlyPrice" numeric(10,2) NOT NULL DEFAULT 0,
  "yearlyPrice" numeric(10,2),
  "maxCompanies" integer NOT NULL DEFAULT 1,
  "maxUsers" integer NOT NULL DEFAULT 1,
  "maxInvoicesPerMonth" integer NOT NULL DEFAULT 100,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id text PRIMARY KEY,
  "userId" text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  "companyId" text NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  "planId" text NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'NONE',
  "providerSubscriptionId" text,
  status text NOT NULL DEFAULT 'TRIAL',
  "trialEndsAt" timestamptz,
  "periodStart" timestamptz,
  "periodEnd" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_companyId_status_idx
ON public.subscriptions("companyId", status);

ALTER TABLE public.companies
ADD COLUMN IF NOT EXISTS "eDonusumIntegrator" "EDonusumIntegrator" NOT NULL DEFAULT 'GIB_PORTAL',
ADD COLUMN IF NOT EXISTS "eDonusumProvider" text,
ADD COLUMN IF NOT EXISTS "eDonusumApiUsername" text,
ADD COLUMN IF NOT EXISTS "eDonusumApiPassword" text,
ADD COLUMN IF NOT EXISTS "eDonusumAlias" text,
ADD COLUMN IF NOT EXISTS "eDonusumApiUrl" text,
ADD COLUMN IF NOT EXISTS "eDonusumLastTestedAt" timestamptz,
ADD COLUMN IF NOT EXISTS "eDonusumLastTestSuccess" boolean,
ADD COLUMN IF NOT EXISTS "invoiceSeriesPrefix" text,
ADD COLUMN IF NOT EXISTS sector text,
ADD COLUMN IF NOT EXISTS "businessModel" text,
ADD COLUMN IF NOT EXISTS "employeeRange" text,
ADD COLUMN IF NOT EXISTS "monthlyInvoiceVolume" text,
ADD COLUMN IF NOT EXISTS "primaryBusinessNeed" text,
ADD COLUMN IF NOT EXISTS "usesEDonusumBefore" boolean,
ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" timestamptz;

ALTER TABLE public.user_companies
ADD COLUMN IF NOT EXISTS "invitedBy" text,
ADD COLUMN IF NOT EXISTS "invitedAt" timestamptz;
